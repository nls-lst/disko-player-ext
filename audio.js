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

// State derived from metadata.json
let albumJson = null; // the raw JSON
let disks = []; // array of disk objects with {diskNum, audioUrl, streamUrl, title, performer, tracks}
let tracks = []; // unified tracks array across all disks with {diskNum, diskTrackIndex, globalIndex, title, performer, index, duration, audioUrl}
let coverUrl = undefined; // resolved cover image
let pdfUrl = undefined; // resolved pdf
let albumTitle = ""; // overall album title
let albumPerformer = ""; // overall album performer
let useRestriction = ""; // use restriction from metadata.json
let currentTrackIndex = 0;
let sound = null;
let isPlaying = false;
let progressInterval = null;

// === JSON metadata loader helpers ===
function parseTimecode(tc) {
  // Timecode is always mm:ss:ff where ff are 75fps frames
  if (!tc) return 0;

  // Trim whitespace and handle malformed timecodes like "01 14:34:33"
  let cleaned = tc.trim();

  // If there's a space before the first colon, remove everything before it
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

  // If disk number is provided, add disk folder structure
  let fullPath = path;
  if (diskNum !== null) {
    fullPath = `disks/disk ${diskNum}/${path}`;
  }

  // Ensure single slash between root and path
  const sep = root.endsWith("/") || fullPath.startsWith("/") ? "" : "/";
  return `${root}${sep}${fullPath}`;
}

// Show an access message when S3 is unreachable (likely offsite)
function showAccessRestrictionMessage() {
  const containerId = "audio-player-container";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    document.body.appendChild(container);
  }

  // Clear existing content
  container.innerHTML = "";

  const msg = document.createElement("div");
  msg.className = "audio-access-message";

  // Add headphones icon
  const iconDiv = document.createElement("div");
  iconDiv.className = "access-message-icon";
  iconDiv.innerHTML = SVG_ICONS.headphones;
  msg.appendChild(iconDiv);

  // Add text content
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

  // Cover: use scans["30"] which is 1000 width per spec; fallback to any available
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

  // PDF if present
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

  // Process ALL disks and build unified tracks array
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

    // Compute durations for this disk's tracks
    for (let i = 0; i < diskTracks.length - 1; i++) {
      diskTracks[i].duration = Math.max(
        0,
        diskTracks[i + 1].index - diskTracks[i].index
      );
    }

    // Compute final track duration when audio metadata loads
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
    setTimeout(() => createMusicPlayer(retries - 1), 1000); // Wait 1 second before retry
    return;
  }

  if (!audioPlayerContainer) {
    console.error("Failed to find audio-player-container after all retries");
    return;
  }

  const container = document.createElement("div");
  container.id = "audio-player";

  // === Playlist Section ===
  const playlistDiv = document.createElement("div");
  playlistDiv.classList.add("playlist");

  const playlistTitle = document.createElement("h3");
  playlistTitle.textContent = "Tracklist";

  playlistDiv.appendChild(playlistTitle);

  // Add disk navigation if multiple disks
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

  // Create track elements from JSON-derived tracks, grouped by disk
  const createTrackElements = () => {
    let currentDiskNum = null;

    tracks.forEach((track) => {
      // Add disk heading if we're starting a new disk (only for multi-disk albums)
      if (track.diskNum !== currentDiskNum) {
        currentDiskNum = track.diskNum;

        // Only show disk headings if there are multiple disks
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

  // === Album Section ===
  const albumDiv = document.createElement("div");
  albumDiv.classList.add("album");

  const albumDetails = document.createElement("div");
  albumDetails.classList.add("details");

  const albumImage = document.createElement("img");
  albumImage.src = coverUrl || "https://placehold.co/200x200";
  albumImage.alt = "Album Art";

  // Make album image clickable if PDF exists (commented out for demo)
  // if (isCueFile && cueData.metadata.pdf) {
  //   albumImage.style.cursor = "pointer";
  //   albumImage.addEventListener("click", () => {
  //     window.open(cueData.metadata.pdf, "_blank");
  //   });
  // }

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

  // === Progress Bar ===
  const progressContainer = document.createElement("div");
  progressContainer.classList.add("progress-container");

  // Time Display
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

  // === Controls (Prev, Play, Next, Volume) ===
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

  // === Volume Control with Icon ===
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

  // Append icon & slider together
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

  // Create track elements after appending to the DOM
  createTrackElements();

  // Embed PDF if it exists
  if (pdfUrl) {
    const pdfContainer = document.createElement("div");
    pdfContainer.classList.add("pdf-container");

    // Add zoom controls
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

    // Add scrollable viewer container
    const scrollContainer = document.createElement("div");
    scrollContainer.classList.add("scroll-container");

    // Add PDF.js viewer container
    const viewerContainer = document.createElement("div");
    viewerContainer.id = "pdf-viewer";
    scrollContainer.appendChild(viewerContainer);
    pdfContainer.appendChild(scrollContainer);

    let currentScale = 1.5;
    let pdfDoc = null;

    // Function to render all pages
    async function renderPages(scale) {
      viewerContainer.innerHTML = ""; // Clear existing pages
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

    // Zoom button handlers
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

    // Load PDF.js
    loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
    )
      .then(() => {
        // Set worker source
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

  // Add rights statement at the bottom (always show, regardless of PDF presence)
  const rightsStatement = document.createElement("div");
  rightsStatement.classList.add("pdf-rights-statement");

  // Determine the rights message based on use restriction
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

// === Play/Pause Functions using Howler.js ===
function playTrack(index) {
  if (sound) {
    sound.stop();
    clearInterval(progressInterval);
  }

  currentTrackIndex = index;
  const track = tracks[index];

  // Check if we need to load a new audio file (switching disks)
  const needsNewAudio = !sound || sound._src[0] !== track.audioUrl;

  if (needsNewAudio) {
    // Load new audio file for this disk
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
    // Same disk, just update the sprite and play
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

// === Progress Bar Update ===
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

// === Update UI ===
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
    playButton.childNodes[1].nodeValue = isPlaying ? " Pause" : " Play"; // Updates text
  }
}

// === Format Time ===
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

// Cleanup function to stop audio and clear intervals
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

// Initialization using metadata.json
async function initPlayer() {
  try {
    // Ensure Howler.js is loaded first
    await ensureHowlerLoaded();

    await loadMetadataJson();
    document.getElementById("audio-player")?.remove();
    createMusicPlayer();

    // Add cleanup listeners for modal close and navigation
    setupCleanupListeners();
  } catch (error) {
    console.error("Failed to initialize audio player:", error);
    // Likely offsite or blocked; show access message
    showAccessRestrictionMessage();
  }
}

// Setup event listeners to stop audio when modal closes or user navigates
function setupCleanupListeners() {
  // Listen for modal close (Primo uses md-dialog)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // Check if modal/dialog is removed from DOM
      mutation.removedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          // Element node
          // Check if the removed node contains our audio player
          if (
            node.querySelector &&
            (node.querySelector("#audio-player-container") ||
              node.id === "audio-player-container")
          ) {
            cleanupPlayer();
          }
          // Check if it's a Primo dialog/modal being closed
          if (
            node.classList &&
            (node.classList.contains("md-dialog-container") ||
              node.classList.contains("full-view-container"))
          ) {
            cleanupPlayer();
          }
        }
      });
    });
  });

  // Observe the body for modal removals
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also listen for navigation events (single page app route changes)
  window.addEventListener("hashchange", cleanupPlayer);
  window.addEventListener("popstate", cleanupPlayer);

  // Listen for Primo's route change events (Angular)
  if (window.angular) {
    const angularElement = window.angular.element(document.body);
    if (angularElement && angularElement.injector) {
      try {
        const $rootScope = angularElement.injector().get("$rootScope");
        $rootScope.$on("$locationChangeStart", cleanupPlayer);
      } catch (e) {
        console.log("Could not attach Angular route listener:", e);
      }
    }
  }

  // Fallback: listen for ESC key (common way to close modals)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Small delay to allow modal to close first
      setTimeout(cleanupPlayer, 100);
    }
  });
}
