// load script helper
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Script load error: ${url}`));
    document.head.appendChild(script);
  });
}

// Load Howler.js if not already loaded
async function ensureHowlerLoaded() {
  if (typeof Howl !== "undefined") {
    console.log("Howler.js already loaded");
    return Promise.resolve();
  }

  console.log("Loading Howler.js...");
  return loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js"
  ).then(() => {
    console.log("Howler.js loaded successfully");
  });
}

// SVG icons
const SVG_ICONS = {
  play: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M8 5v14l11-7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
  skip_next: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>`,
  skip_previous: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`,
  volume_up: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="white" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
  headphones: `<svg viewBox="0 0 24 24" width="120" height="120" fill="currentColor"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>`,
};
function getRoot() {
  // Configure base S3 URL here
  const base = "https://your-bucket.s3.amazonaws.com/audio/";
  const id =
    typeof dodID !== "undefined"
      ? dodID
      : typeof window !== "undefined"
      ? window.dodID
      : "";
  return `${base}${id || ""}`;
}

let albumJson = null;
let disks = [];
let tracks = [];
let coverUrl = undefined;
let pdfUrl = undefined;
let albumTitle = "";
let albumPerformer = "";
let useRestriction = "";
let currentTrackIndex = 0;
let sound = null;
let isPlaying = false;
let progressInterval = null;

function parseTimecode(tc) {
  // Parse timecode format: mm:ss:ff (75fps frames)
  if (!tc) return 0;

  let cleaned = tc.trim();

  if (cleaned.includes(" ") && cleaned.indexOf(" ") < cleaned.indexOf(":")) {
    cleaned = cleaned.substring(cleaned.indexOf(" ") + 1);
  }

  const parts = cleaned.split(":");

  const [m, s, f] = [
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    parseInt(parts[2], 10) || 0,
  ];
  return m * 60 + s + f / 75;
}

function resolveUrl(path, diskNum = null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const root = getRoot();

  let fullPath = path;
  if (diskNum !== null) {
    fullPath = `disks/disk ${diskNum}/${path}`;
  }

  const sep = root.endsWith("/") || fullPath.startsWith("/") ? "" : "/";
  return `${root}${sep}${fullPath}`;
}

function showAccessRestrictionMessage() {
  const containerId = "audio-player-container";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    document.body.appendChild(container);
  }

  container.innerHTML = "";

  const msg = document.createElement("div");
  msg.className = "audio-access-message";

  const iconDiv = document.createElement("div");
  iconDiv.className = "access-message-icon";
  iconDiv.innerHTML = SVG_ICONS.headphones;
  msg.appendChild(iconDiv);

  const textDiv = document.createElement("div");
  textDiv.className = "access-message-text";

  const link = document.createElement("a");
  link.href = "https://www.nls.uk/visit/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "National Library of Scotland Reading Rooms";

  const textBefore = document.createTextNode(
    "A recording of this item has been digitised by the National Library of Scotland. You can listen to the audio in the "
  );
  const textAfter = document.createTextNode(" in Edinburgh or Glasgow.");

  textDiv.appendChild(textBefore);
  textDiv.appendChild(link);
  textDiv.appendChild(textAfter);

  msg.appendChild(textDiv);

  container.appendChild(msg);
}

async function loadMetadataJson() {
  const url = resolveUrl("metadata.json");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load metadata.json: ${res.status}`);
  const data = await res.json();
  albumJson = data;
  // Get use restriction from root of metadata
  useRestriction = data.use || "";

  // Use first disk's metadata for overall album info
  const firstDisk = data.disks?.[0];
  const firstCue = firstDisk?.cue || {};
  albumTitle = firstCue.TITLE || "";
  albumPerformer = firstCue.PERFORMER || "";

  coverUrl = undefined;
  if (data.scans) {
    const s30 = data.scans["30"];
    let coverUrlResolved;
    let scanId;

    if (s30 && s30.files && s30.files.length) {
      scanId = "30";
      coverUrlResolved = resolveUrl(`scans/${scanId}/${s30.files[0]}`);
    } else {
      const entries = Object.entries(data.scans).filter(
        ([key, v]) => v && v.files && v.width
      );
      if (entries.length) {
        const [bestKey, bestValue] = entries.reduce((a, b) =>
          a[1].width > b[1].width ? a : b
        );
        scanId = bestKey;
        coverUrlResolved = resolveUrl(`scans/${scanId}/${bestValue.files[0]}`);
      } else {
        const entry = Object.entries(data.scans).find(
          ([key, v]) => v && v.files
        );
        if (entry) {
          const [key, value] = entry;
          scanId = key;
          coverUrlResolved = resolveUrl(`scans/${scanId}/${value.files[0]}`);
        }
      }
    }
    if (coverUrlResolved) {
      coverUrl = coverUrlResolved;
    }
  }

  pdfUrl = undefined;
  if (data.scans) {
    for (const key of Object.keys(data.scans)) {
      const v = data.scans[key];
      if (v && v.files && v.files.length) {
        const pdfFile = v.files.find((f) => f.toLowerCase().endsWith(".pdf"));
        if (pdfFile) {
          pdfUrl = resolveUrl(`scans/${key}/${pdfFile}`);
          break;
        }
      }
    }
  }

  disks = [];
  tracks = [];
  let globalIndex = 0;

  for (const disk of data.disks || []) {
    const diskNum = disk.disk || "1";
    const cue = disk.cue || {};
    const audioUrl = resolveUrl(disk.file || "", diskNum);
    const streamUrl = resolveUrl(disk.stream || "", diskNum);

    const diskTracks = (cue.tracks || []).map((t, idx) => ({
      diskNum: diskNum,
      diskTrackIndex: idx,
      globalIndex: globalIndex++,
      title: t.TITLE || `Track ${idx + 1}`,
      performer: t.PERFORMER || cue.PERFORMER || "",
      index: parseTimecode(t.INDEX),
      duration: undefined,
      audioUrl: audioUrl,
    }));

    for (let i = 0; i < diskTracks.length - 1; i++) {
      diskTracks[i].duration = Math.max(
        0,
        diskTracks[i + 1].index - diskTracks[i].index
      );
    }

    if (diskTracks.length && audioUrl) {
      const lastIdx = diskTracks.length - 1;
      const audio = new Audio(audioUrl);
      audio.addEventListener("loadedmetadata", () => {
        const last = diskTracks[lastIdx];
        last.duration = Math.max(0, audio.duration - last.index);
        const el = document.querySelector(
          `.track[data-index="${last.globalIndex}"] .track-duration`
        );
        if (el) el.textContent = formatTime(last.duration);
      });
    }

    disks.push({
      diskNum: diskNum,
      audioUrl: audioUrl,
      streamUrl: streamUrl,
      title: cue.TITLE || "",
      performer: cue.PERFORMER || "",
      tracks: diskTracks,
    });

    tracks.push(...diskTracks);
  }
}

function createMusicPlayer(retries = 5) {
  const audioPlayerContainer = document.getElementById(
    "audio-player-container"
  );

  if (!audioPlayerContainer && retries > 0) {
    console.log(
      `audio-player-container not found, retrying... (${retries} attempts left)`
    );
    setTimeout(() => createMusicPlayer(retries - 1), 1000);
    return;
  }

  if (!audioPlayerContainer) {
    console.error("Failed to find audio-player-container after all retries");
    return;
  }

  const container = document.createElement("div");
  container.id = "audio-player";

  const playlistDiv = document.createElement("div");
  playlistDiv.classList.add("playlist");

  const playlistTitle = document.createElement("h3");
  playlistTitle.textContent = "Tracklist";

  playlistDiv.appendChild(playlistTitle);

  if (disks.length > 1) {
    const diskNav = document.createElement("div");
    diskNav.classList.add("disk-navigation");

    disks.forEach((disk, idx) => {
      const diskLink = document.createElement("a");
      diskLink.href = `#disk-${disk.diskNum}`;
      diskLink.textContent = `Disk ${disk.diskNum}`;
      diskLink.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(`disk-${disk.diskNum}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      diskNav.appendChild(diskLink);
    });

    playlistDiv.appendChild(diskNav);
  }

  const tracksContainer = document.createElement("div");

  const createTrackElements = () => {
    let currentDiskNum = null;

    tracks.forEach((track) => {
      if (track.diskNum !== currentDiskNum) {
        currentDiskNum = track.diskNum;

        if (disks.length > 1) {
          const diskHeading = document.createElement("div");
          diskHeading.id = `disk-${track.diskNum}`;
          diskHeading.classList.add("disk-heading");
          diskHeading.textContent = `Disk ${track.diskNum}`;
          tracksContainer.appendChild(diskHeading);
        }
      }

      const trackDiv = document.createElement("div");
      trackDiv.classList.add("track");
      trackDiv.dataset.index = track.globalIndex;
      trackDiv.tabIndex = 0;

      const icon = document.createElement("span");
      icon.innerHTML = SVG_ICONS.play;

      const trackInfo = document.createElement("div");
      trackInfo.classList.add("track-info");

      const trackTitle = document.createElement("p");
      trackTitle.textContent =
        track.title || `Track ${track.diskTrackIndex + 1}`;

      const trackArtist = document.createElement("p");
      trackArtist.textContent = track.performer || "Unknown Artist";

      trackInfo.appendChild(trackTitle);
      trackInfo.appendChild(trackArtist);

      const duration = document.createElement("span");
      duration.classList.add("track-duration");
      duration.textContent =
        track.duration !== undefined
          ? formatTime(track.duration)
          : "Loading...";

      trackDiv.appendChild(icon);
      trackDiv.appendChild(trackInfo);
      trackDiv.appendChild(duration);

      trackDiv.addEventListener("click", () => playTrack(track.globalIndex));
      trackDiv.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          playTrack(track.globalIndex);
        }
      });

      tracksContainer.appendChild(trackDiv);
    });
  };

  playlistDiv.appendChild(tracksContainer);

  const albumDiv = document.createElement("div");
  albumDiv.classList.add("album");

  const albumDetails = document.createElement("div");
  albumDetails.classList.add("details");

  const albumImage = document.createElement("img");
  albumImage.src = coverUrl || "https://placehold.co/200x200";
  albumImage.alt = "Album Art";

  const albumInfo = document.createElement("div");
  albumInfo.classList.add("info");

  const albumTitleEl = document.createElement("h2");
  albumTitleEl.textContent = albumTitle || "Album Title";

  const albumArtist = document.createElement("p");
  albumArtist.textContent = albumPerformer || "Artist";

  const nowPlaying = document.createElement("p");
  nowPlaying.id = "now-playing";

  const playButton = document.createElement("button");
  playButton.classList.add("play-button");
  playButton.id = "play-btn";
  playButton.tabIndex = 0;

  const playIcon = document.createElement("span");
  playIcon.innerHTML = SVG_ICONS.play;

  playButton.appendChild(playIcon);
  playButton.append("Play");
  playButton.addEventListener("click", togglePlay);

  albumInfo.appendChild(albumTitleEl);
  albumInfo.appendChild(albumArtist);
  albumInfo.appendChild(playButton);

  albumDetails.appendChild(albumImage);
  albumDetails.appendChild(albumInfo);
  albumDiv.appendChild(albumDetails);
  albumDiv.appendChild(nowPlaying);

  const progressContainer = document.createElement("div");
  progressContainer.classList.add("progress-container");

  const timeDisplay = document.createElement("div");
  timeDisplay.classList.add("time-display");
  timeDisplay.textContent = "0:00 / 0:00";

  const progressBar = document.createElement("input");
  progressBar.type = "range";
  progressBar.min = 0;
  progressBar.max = 100;
  progressBar.value = 0;
  progressBar.classList.add("progress-bar");
  progressBar.tabIndex = 0;

  progressBar.addEventListener("input", () => {
    if (sound) {
      sound.seek((progressBar.value / 100) * sound.duration());
    }
  });
  progressContainer.appendChild(timeDisplay);
  progressContainer.appendChild(progressBar);
  albumDiv.appendChild(progressContainer);

  const controlsDiv = document.createElement("div");
  controlsDiv.classList.add("controls");

  const prevButton = document.createElement("button");
  prevButton.innerHTML = SVG_ICONS.skip_previous;
  prevButton.tabIndex = 0;
  prevButton.setAttribute("aria-label", "Previous track");
  prevButton.addEventListener("click", playPrevious);

  const nextButton = document.createElement("button");
  nextButton.innerHTML = SVG_ICONS.skip_next;
  nextButton.tabIndex = 0;
  nextButton.setAttribute("aria-label", "Next track");
  nextButton.addEventListener("click", playNext);

  const volumeControl = document.createElement("div");
  volumeControl.classList.add("volume-control");

  const volumeIcon = document.createElement("span");
  volumeIcon.innerHTML = SVG_ICONS.volume_up;

  const volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.min = 0;
  volumeSlider.max = 1;
  volumeSlider.step = 0.01;
  volumeSlider.value = 1;
  volumeSlider.classList.add("volume-slider");
  volumeSlider.tabIndex = 0;

  volumeSlider.addEventListener("input", () => {
    if (sound) sound.volume(volumeSlider.value);
  });

  volumeControl.appendChild(volumeIcon);
  volumeControl.appendChild(volumeSlider);

  controlsDiv.appendChild(prevButton);
  controlsDiv.appendChild(playButton);
  controlsDiv.appendChild(nextButton);
  controlsDiv.appendChild(volumeControl);
  albumDiv.appendChild(controlsDiv);

  container.appendChild(playlistDiv);
  container.appendChild(albumDiv);

  audioPlayerContainer.appendChild(container);

  createTrackElements();

  if (pdfUrl) {
    const pdfContainer = document.createElement("div");
    pdfContainer.classList.add("pdf-container");

    const zoomControls = document.createElement("div");
    zoomControls.classList.add("zoom-controls");

    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.textContent = "−";
    zoomOutBtn.tabIndex = 0;
    zoomOutBtn.classList.add("zoom-btn");
    zoomOutBtn.setAttribute("aria-label", "Zoom out PDF");

    const zoomLevel = document.createElement("span");
    zoomLevel.textContent = "100%";
    zoomLevel.classList.add("zoom-level");

    const zoomInBtn = document.createElement("button");
    zoomInBtn.textContent = "+";
    zoomInBtn.tabIndex = 0;
    zoomInBtn.classList.add("zoom-btn");
    zoomInBtn.setAttribute("aria-label", "Zoom in PDF");

    zoomControls.appendChild(zoomOutBtn);
    zoomControls.appendChild(zoomLevel);
    zoomControls.appendChild(zoomInBtn);
    pdfContainer.appendChild(zoomControls);

    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("scroll-container");

    const viewerContainer = document.createElement("div");
    viewerContainer.id = "pdf-viewer";
    scrollContainer.appendChild(viewerContainer);
    pdfContainer.appendChild(scrollContainer);

    let currentScale = 1.5;
    let pdfDoc = null;

    async function renderPages(scale) {
      viewerContainer.innerHTML = "";
      const numPages = pdfDoc.numPages;

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        viewerContainer.appendChild(canvas);

        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;
      }
    }

    zoomInBtn.addEventListener("click", async () => {
      currentScale += 0.25;
      zoomLevel.textContent = Math.round((currentScale / 1.5) * 100) + "%";
      await renderPages(currentScale);
    });

    zoomOutBtn.addEventListener("click", async () => {
      if (currentScale > 0.5) {
        currentScale -= 0.25;
        zoomLevel.textContent = Math.round((currentScale / 1.5) * 100) + "%";
        await renderPages(currentScale);
      }
    });

    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    )
      .then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

        return window.pdfjsLib.getDocument(pdfUrl).promise;
      })
      .then(async (pdf) => {
        pdfDoc = pdf;
        await renderPages(currentScale);
      })
      .catch((error) => {
        console.error("Error loading PDF:", error);
        pdfContainer.innerHTML =
          "<p style='padding: 20px; color: white;'>Failed to load PDF. No preview available.</p>";
      });

    audioPlayerContainer.appendChild(pdfContainer);
  }

  const rightsStatement = document.createElement("div");
  rightsStatement.classList.add("pdf-rights-statement");

  let rightsMessage = "";
  if (useRestriction === "access is onsite only") {
    rightsMessage =
      "This work is protected by copyright. You may only use this work as permitted by copyright legislation or by the terms of a licence from the copyright owner(s). For more information please see <a href='https://www.nls.uk/tools-for-research/copyright/#statements-and-licences' target='_blank'>our copyright page</a>.";
  } else {
    rightsMessage = "global access placeholder";
  }
  rightsStatement.innerHTML = rightsMessage;
  audioPlayerContainer.appendChild(rightsStatement);
}

function playTrack(index) {
  if (sound) {
    sound.stop();
    clearInterval(progressInterval);
  }

  currentTrackIndex = index;
  const track = tracks[index];

  const needsNewAudio = !sound || sound._src[0] !== track.audioUrl;

  if (needsNewAudio) {
    sound = new Howl({
      src: [track.audioUrl],
      html5: true,
      sprite: {
        track: [track.index * 1000, (track.duration || 300) * 1000],
      },
      onload: () => {
        console.log(`Loaded audio for disk ${track.diskNum}`);
        sound.play("track");
      },
      onplay: () => {
        isPlaying = true;
        updateUI();
        startProgressUpdate();
      },
      onend: () => {
        isPlaying = false;
        updateUI();
        if (currentTrackIndex < tracks.length - 1) {
          playTrack(currentTrackIndex + 1);
        }
      },
      onerror: (id, error) => {
        console.error(`Error loading audio for disk ${track.diskNum}:`, error);
      },
    });
  } else {
    sound = new Howl({
      src: [track.audioUrl],
      html5: true,
      sprite: {
        track: [track.index * 1000, (track.duration || 300) * 1000],
      },
      onplay: () => {
        isPlaying = true;
        updateUI();
        startProgressUpdate();
      },
      onend: () => {
        isPlaying = false;
        updateUI();
        if (currentTrackIndex < tracks.length - 1) {
          playTrack(currentTrackIndex + 1);
        }
      },
    });
    sound.play("track");
  }
}

function togglePlay() {
  if (!sound) {
    playTrack(currentTrackIndex);
  } else if (isPlaying) {
    sound.pause();
    isPlaying = false;
  } else {
    sound.play();
    isPlaying = true;
  }
  updateUI();
}

function playPrevious() {
  currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
  playTrack(currentTrackIndex);
}

function playNext() {
  currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  playTrack(currentTrackIndex);
}

function startProgressUpdate() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  progressInterval = setInterval(() => {
    if (sound && sound.playing()) {
      const currentTime = formatTime(sound.seek());
      const totalTime = formatTime(sound.duration());
      document.querySelector(
        ".time-display"
      ).textContent = `${currentTime} / ${totalTime}`;

      const progressBar = document.querySelector(".progress-bar");
      if (progressBar) {
        const progress = (sound.seek() / sound.duration()) * 100;
        progressBar.value = progress;
        progressBar.style.setProperty("--progress", `${progress}%`);
      }
    }
  }, 500);
}

function updateUI() {
  const playButton = document.querySelector("#play-btn");
  const playIcon = playButton.querySelector("span");
  const nowPlayingText = document.querySelector("#now-playing");

  if (nowPlayingText) {
    if (isPlaying) {
      nowPlayingText.textContent = `Currently Playing: ${tracks[currentTrackIndex].title}`;
      nowPlayingText.classList.add("active");
    } else {
      nowPlayingText.classList.remove("active");
    }
  }
  const allTracks = document.querySelectorAll(".track");
  allTracks.forEach((track) => track.classList.remove("playing-track"));

  const currentTrack = document.querySelector(
    `.track[data-index="${currentTrackIndex}"]`
  );
  if (currentTrack) {
    currentTrack.classList.add("playing-track");
  }

  if (playButton) {
    playIcon.innerHTML = isPlaying ? SVG_ICONS.pause : SVG_ICONS.play;
    playButton.childNodes[1].nodeValue = isPlaying ? " Pause" : " Play";
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

// Cleanup function - call to stop playback and free resources
function cleanupPlayer() {
  if (sound) {
    sound.stop();
    sound.unload();
    sound = null;
  }
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  isPlaying = false;
  console.log("Audio player cleaned up");
}

async function initPlayer() {
  try {
    await ensureHowlerLoaded();

    await loadMetadataJson();
    document.getElementById("audio-player")?.remove();
    createMusicPlayer();
  } catch (error) {
    console.error("Failed to initialize audio player:", error);
    showAccessRestrictionMessage();
  }
}
