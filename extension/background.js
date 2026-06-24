import {
  normalizeTranscriptPayload,
  parseTimedTextXml,
  parseYoutubeJson3,
  providerUrlForVideo,
} from './lib/transcript.mjs';

async function configureSidePanel() {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (error) {
    console.warn('[Hermes Browser] Unable to set side panel behavior:', error);
  }
}

async function openHermesPanel(tab) {
  try {
    if (chrome.sidePanel?.open && tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    }
  } catch (error) {
    console.warn('[Hermes Browser] Side panel open failed, falling back to extension tab:', error);
  }

  const manifest = chrome.runtime.getManifest();
  const panelPath = manifest.side_panel?.default_path || 'sidepanel.html';
  await chrome.tabs.create({ url: chrome.runtime.getURL(panelPath) });
}

function timeoutSignal(ms = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timeout) };
}

async function fetchUserConfiguredTranscript(videoId, provider) {
  const url = providerUrlForVideo(provider, videoId);
  if (!url) return { ok: false, reason: 'custom_provider_not_configured', source: 'custom' };
  const { controller, done } = timeoutSignal();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json, text/plain;q=0.9' } });
    const text = await response.text();
    if (!response.ok) return { ok: false, reason: `custom_provider_${response.status}`, source: 'custom' };
    try {
      return normalizeTranscriptPayload(JSON.parse(text), 'custom');
    } catch {
      return normalizeTranscriptPayload({ text }, 'custom');
    }
  } finally {
    done();
  }
}

async function fetchDefaultTimedTextTranscript(videoId) {
  const attempts = [
    `https://video.google.com/timedtext?fmt=json3&lang=en&v=${encodeURIComponent(videoId)}`,
    `https://video.google.com/timedtext?fmt=json3&lang=en&kind=asr&v=${encodeURIComponent(videoId)}`,
    `https://video.google.com/timedtext?lang=en&v=${encodeURIComponent(videoId)}`,
    `https://video.google.com/timedtext?lang=en&kind=asr&v=${encodeURIComponent(videoId)}`,
  ];
  for (const url of attempts) {
    const { controller, done } = timeoutSignal();
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) continue;
      const text = await response.text();
      if (!text.trim()) continue;
      let segments = [];
      if (url.includes('fmt=json3')) {
        try {
          segments = parseYoutubeJson3(JSON.parse(text));
        } catch {
          segments = [];
        }
      } else {
        segments = parseTimedTextXml(text);
      }
      if (segments.length) {
        return normalizeTranscriptPayload({ segments, language: 'en' }, 'default-timedtext');
      }
    } catch (_error) {
      // Try next shape.
    } finally {
      done();
    }
  }
  return { ok: false, reason: 'default_timedtext_unavailable', source: 'default-timedtext' };
}

async function fetchDomTranscript(tabId) {
  if (!tabId) return { ok: false, reason: 'no_active_tab', source: 'page-dom' };
  try {
    return normalizeTranscriptPayload(
      await chrome.tabs.sendMessage(tabId, { type: 'HERMES_GET_YOUTUBE_TRANSCRIPT_DOM' }),
      'page-dom',
    );
  } catch (error) {
    return { ok: false, reason: error?.message || String(error), source: 'page-dom' };
  }
}

async function getYoutubeTranscript({ videoId, tabId, provider = 'default' } = {}) {
  const cleanVideoId = String(videoId || '').trim();
  const mode = String(provider || 'default').trim();
  if (!cleanVideoId) return { ok: false, reason: 'missing_video_id' };
  if (mode.toLowerCase() === 'off') return { ok: false, reason: 'transcripts_disabled' };

  const attempts = [];
  if (/^https?:\/\//i.test(mode)) attempts.push(() => fetchUserConfiguredTranscript(cleanVideoId, mode));
  attempts.push(() => fetchDefaultTimedTextTranscript(cleanVideoId));
  attempts.push(() => fetchDomTranscript(tabId));

  const failures = [];
  for (const attempt of attempts) {
    const result = await attempt();
    if (result?.ok && (result.text || result.segments?.length)) return { ...result, videoId: cleanVideoId };
    failures.push({ source: result?.source || 'unknown', reason: result?.reason || 'unavailable' });
  }
  return { ok: false, videoId: cleanVideoId, reason: failures.map((item) => `${item.source}:${item.reason}`).join('; ') || 'transcript_unavailable' };
}

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);
chrome.action.onClicked.addListener(openHermesPanel);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'HERMES_GET_YOUTUBE_TRANSCRIPT') return false;
  getYoutubeTranscript(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, reason: error?.message || String(error) }));
  return true;
});
