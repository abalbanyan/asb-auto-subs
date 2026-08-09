import { AnimeSite, animeSites } from "./animeSites";

const globalWindow = window as typeof window & { asbAutoSubsInjected?: boolean };

type ToastOptions = {
  persistent?: boolean;
  dismissOnApiKeySet?: boolean;
  onClick?: () => void;
};

const missingApiKeyToastClassName = "subs-toast-missing-api-key";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAnimeMetaData(animeSite: AnimeSite) {
  const retryDelayMs = 250;
  const maxAttempts = 40;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (animeSite.isMetaDataReady && !animeSite.isMetaDataReady()) {
      await sleep(retryDelayMs);
      continue;
    }

    const anilistId = animeSite.getAnilistId();
    const title = animeSite.getTitle();
    const episode = animeSite.getEpisode();
    if (episode && (anilistId || title)) {
      return { anilistId, title, episode };
    }
    if (!animeSite.isMetaDataReady) {
      return { anilistId, title, episode };
    }
    await sleep(retryDelayMs);
  }

  if (animeSite.isMetaDataReady) {
    return { anilistId: null, title: null, episode: null };
  }

  const anilistId = animeSite.getAnilistId();
  const title = animeSite.getTitle();
  const episode = animeSite.getEpisode();
  return { anilistId, title, episode };
}

async function loadSubsIntoAsb(name: string, base64: string) {
  const retryDelayMs = 250;
  const maxAttempts = 20;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const dragTarget = document.querySelector(".asbplayer-drag-zone-initial");
    if (dragTarget) {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], name, { type: "text/plain" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const dropEvent = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      dragTarget.dispatchEvent(dropEvent);
      return true;
    }
    await sleep(retryDelayMs);
  }

  return false;
}

if (!globalWindow.asbAutoSubsInjected) {
  globalWindow.asbAutoSubsInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case "alreadyDownloadedInfo":
        createToast("Subtitles already downloaded once", "#ff9318d3");
        break;
      case "getAnimeMetaData":
        const animeSite: AnimeSite = animeSites.get(message.animeSiteKey)!;
        getAnimeMetaData(animeSite).then(({ anilistId, title, episode }) => {
          if (!episode || (!anilistId && !title)) {
            createToast("Couldn't get anime data", "#a51f07");
            sendResponse(null);
            return;
          }
          sendResponse({ anilistId, title, episode });
        });
        return true;
      case "loadSubsIntoAsb":
        loadSubsIntoAsb(message.name, message.base64).then(sendResponse);
        return true;
      case "notifyError":
        createToast(message.error, "#a51f07");
        break;
      case "notifyMissingJimakuApiKey":
        createToast(message.message, "#a51f07", {
          persistent: true,
          dismissOnApiKeySet: true,
          onClick: () => {
            chrome.runtime.sendMessage({ action: "openExtensionPopup" });
          },
        });
        break;
      case "notifyLoadedIntoAsb":
        createToast(
          loadedSubtitlesMessage("Loaded subtitles", message),
          "#0a9611",
        );
        break;
      case "notifySubtitleSwitched":
        createToast(
          subtitleSwitchedMessage("Switched loaded subtitle file", message),
          "#0a9611",
        );
        break;
      case "notifySuccess":
        createToast(
          successMessage("Successfully downloaded subtitles", message),
          "#0a9611",
        );
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    if (!hasJimakuApiKey(changes.apiKey?.newValue)) return;
    removeMissingApiKeyToasts();
  });
}

function hasJimakuApiKey(apiKey: unknown) {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

function successMessage(
  baseMessage: string,
  message: { title?: unknown; episode?: unknown },
) {
  const title = typeof message.title === "string" ? message.title.trim() : "";
  const episode =
    typeof message.episode === "number" && Number.isFinite(message.episode)
      ? message.episode
      : null;

  if (!title || episode === null) return baseMessage;
  return `${baseMessage} for ${title} episode ${episode}`;
}

function loadedSubtitlesMessage(
  baseMessage: string,
  message: { title?: unknown; episode?: unknown; name?: unknown },
) {
  const name = typeof message.name === "string" ? message.name.trim() : "";
  const prefix = successMessage(baseMessage, message);
  if (!name) return prefix;
  return `${prefix}: ${name}`;
}

function subtitleSwitchedMessage(
  baseMessage: string,
  message: { name?: unknown },
) {
  const name = typeof message.name === "string" ? message.name.trim() : "";
  if (!name) return baseMessage;
  return `${baseMessage}: ${name}`;
}

function createToast(msg: string, color: string, options: ToastOptions = {}) {
  const toastContainer = getToastContainer();
  const toast = document.createElement("div");
  toast.className = "subs-toast";
  if (!options.persistent) {
    toast.classList.add("transient");
  }
  if (options.onClick) {
    toast.classList.add("clickable");
    toast.addEventListener("click", options.onClick);
  }
  if (options.dismissOnApiKeySet) {
    toast.classList.add(missingApiKeyToastClassName);
  }
  toast.style.backgroundColor = color;

  const message = document.createElement("span");
  message.textContent = msg;
  toast.append(message);

  if (options.persistent) {
    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.className = "subs-toast-dismiss";
    dismissButton.setAttribute("aria-label", "Dismiss notification");
    dismissButton.textContent = "x";
    dismissButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeToast(toast, toastContainer);
    });
    toast.append(dismissButton);
  }

  toast.classList.add("show");
  toastContainer.append(toast);
  if (options.persistent) return;

  setTimeout(() => {
    removeToast(toast, toastContainer);
  }, 3500);
}

function removeMissingApiKeyToasts() {
  document
    .querySelectorAll<HTMLElement>(`.${missingApiKeyToastClassName}`)
    .forEach((toast) => removeToast(toast));
}

function removeToast(toast: HTMLElement, toastContainer = toast.parentElement) {
  toast.classList.remove("show");
  toast.remove();
  if (toastContainer && !toastContainer.hasChildNodes()) {
    toastContainer.remove();
  }
}

function getToastContainer() {
  const existingContainer = document.querySelector(".subs-toast-container");
  if (existingContainer instanceof HTMLElement) {
    return existingContainer;
  }

  const toastContainer = document.createElement("div");
  toastContainer.className = "subs-toast-container";
  document.body.append(toastContainer);
  return toastContainer;
}
