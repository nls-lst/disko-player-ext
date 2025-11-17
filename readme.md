# Disko Audio Player

An audio player for single-file and multi-disc audio albums. Optional PDF liner notes display.

## Dependencies

Dependencies are loaded within the script:

- **[Howler.js](https://github.com/goldfire/howler.js)** - Audio playback (loaded on init)
- **[PDF.js](https://github.com/mozilla/pdf.js)** - PDF rendering (loaded when PDF is available)

## Quick Start

### 1. Configure S3 bucket URL

Edit the `getRoot()` function in `audio.js`:

```javascript
function getRoot() {
  // Configure your base S3 URL here
  const base = "https://your-bucket.s3.amazonaws.com/audio/";
  const id = typeof dodID !== "undefined" ? dodID : window.dodID || "";
  return `${base}${id || ""}`;
}
```

### 2. Include the files

```html
<link rel="stylesheet" href="path/to/audio.css" />
<script src="path/to/audio.js"></script>
```

### 3. Add the container element

```html
<div id="audio-player-container"></div>
```

### 4. Set the DOD ID

```javascript
window.dodID = "123456789";
```

### 5. Initialize the player

```javascript
initPlayer();
```

## Asset Structure

```
<bucket-url>/
├── {DODID}/
│   ├── metadata.json
│   ├── disks/
│   │   ├── disk 1/
│   │   │   ├── audio.ogg
│   │   └── disk 2/
│   │       └── ...
│   └── scans/
│       ├── 30/                 # Scan ID (30 = 1000px width)
│       │   ├── cover.jpg
│       │   └── ...
│       └── 23/
│           └── liner-notes.pdf
```

## Metadata JSON Format

The player expects a `metadata.json` file with the following structure:

```json
{
  "dodid": "266169666",
  "use": "access is onsite only",
  "disks": [
    {
      "disk": "1",
      "file": "21/267215439.21.ogg",
      "cue": {
        "PERFORMER": "Sheena Wellington",
        "TITLE": "Greentrax 10th Anniversary",
        "tracks": [
          {
            "TITLE": "The Nodding Song",
            "PERFORMER": "Ceolbeg",
            "INDEX": "00:00:00"
          },
          {
            "TITLE": "Doherty's / Return to Milltown",
            "PERFORMER": "Tony McManus",
            "INDEX": "03:50:67"
          }
        ]
      }
    },
    {
      "disk": "2",
      "file": "21/267215436.21.ogg",
      "cue": {
        "PERFORMER": "Rua",
        "TITLE": "The Music & Songs of Greentrax",
        "tracks": [
          {
            "TITLE": "No Gods and Precious Few Heroes",
            "PERFORMER": "Brian McNeill",
            "INDEX": "00:00:00"
          }
        ]
      }
    }
  ],
  "scans": {
    "30": {
      "files": ["267215424.30.jpg", "267215427.30.jpg"],
      "partrefs": ["cover", "disc"],
      "titles": ["The Music & Songs of Greentrax", "The Music & Songs of Greentrax"],
      "width": 1000
    },
    "23": {
      "files": ["267215421.23.pdf"],
      "partrefs": ["booklet"],
      "titles": ["The Music & Songs of Greentrax"]
    }
  }
}
```

### Field Reference

- **dodid**: Identifier for the recording
- **use**: Access restriction text (e.g., "access is onsite only")
- **disks**: Array of disc objects
  - **disk**: Disc number (string)
  - **file**: Path to audio file (relative to disk folder)
  - **cue**: Track metadata
    - **PERFORMER**: Album artist
    - **TITLE**: Album title
    - **tracks**: Array of track objects
      - **TITLE**: Track name
      - **PERFORMER**: Track artist (optional, falls back to album artist)
      - **INDEX**: Timecode in `mm:ss:ff` format (75fps frames)
- **scans**: Object keyed by scan ID
  - **files**: Array of image/PDF filenames
  - **partrefs**: Array of part references (e.g., "cover", "disc", "booklet") - optional
  - **titles**: Array of titles corresponding to each file - optional
  - **width**: Image width in pixels (for images only)

## Customization

### Styling

Key CSS classes:

- `.audio-player` - Main container
- `.album` - Album info and controls section
- `.playlist` - Track listing section
- `.track` - Individual track item
- `.playing-track` - Currently playing track
- `.controls` - Playback control buttons
- `.pdf-container` - PDF viewer section

### Access Restrictions

The player displays a custom message when content is restricted. Edit the `showAccessRestrictionMessage()` function to customize this behavior.
