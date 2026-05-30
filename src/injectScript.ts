import { AnimeSite, animeSites } from "./animeSites";

const globalWindow = window as typeof window & { asbAutoSubsInjected?: boolean };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAnimeMetaData(animeSite: AnimeSite) {
  const retryDelayMs = 100;
  const maxAttempts = 10;

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
        createToast("Subs already downloaded once", "#ff9318d3");
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
      case "notifyLoadedIntoAsb":
        createToast("Successfully downloaded and loaded subs", "#0a9611");
        break;
      case "notifySuccess":
        createToast("Successfully downloaded subs", "#0a9611");
    }
  });
}

function createToast(msg: string, color: string) {
  const toast = document.createElement("div");
  toast.className = "subs-toast";
  toast.textContent = msg;
  toast.style.backgroundColor = color;
  toast.className += " show";
  document.body.append(toast);
  setTimeout(() => {
    toast.className = toast.className.replace("show", "");
    toast.remove();
  }, 3000);
}
