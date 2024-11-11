// Main application class to handle the audio editor functionality
class AudioEditor {
  constructor() {
    // Audio contexts and nodes
    this.audioContext = null;
    this.analyser = null;
    this.mediaRecorder = null;

    // State management
    this.isPlaying = false;
    this.isRecording = false;
    this.startTime = 0;
    this.audioChunks = [];

    // Track recording state
    this.recordingTracks = [];
    this.recordingClips = [];

    // DOM elements
    this.elements = {
      playButton: document.getElementById("play"),
      stopButton: document.getElementById("stop"),
      recordButton: document.getElementById("record"),
      timeDisplay: document.getElementById("time"),
      meterFill: document.querySelector(".meter-fill"),
      tracksContainer: document.querySelector(".tracks-container"),
      mixer: document.querySelector(".mixer"),
      clips: document.querySelectorAll(".clip"),
      tracks: document.querySelectorAll(".track"),
      faders: document.querySelectorAll(".fader"),
      playheadContainer: document.querySelector(".playhead-container"),
      playheadCaret: document.querySelector(".playhead-caret"),
      playheadLine: document.querySelector(".playhead-line"),
      timescaleCanvas: document.getElementById("timescale-canvas"),
      bpmInput: document.getElementById("bpm-input"),
      displayModeSwitch: document.getElementById("display-mode-switch"),
      armButtons: document.querySelectorAll(".arm-button"),
      meterFills: document.querySelectorAll(".input-meter-fill"),
    };

    // Drag state
    this.draggedClip = null;
    this.dragOffset = 0;

    this.pixelsPerSecond = 100; // How many pixels represent one second
    this.playheadPosition = 0;

    // Add new state for playhead dragging
    this.isDraggingPlayhead = false;
    this.playheadDragStartX = 0;

    // Add BPM-related properties
    this.bpm = 120; // Default BPM
    this.beatsPerBar = 4; // Standard 4/4 time signature
    this.pixelsPerBeat = this.pixelsPerSecond * (60 / this.bpm); // Calculate pixels per beat

    // Add display mode state
    this.displayMode = "beats"; // 'beats' or 'time'

    // Add clip counter for naming
    this.clipCounter = 1;

    // Add armed tracks state
    this.armedTracks = new Set();

    // Add input handling properties
    this.availableInputs = [];
    this.trackInputs = new Map(); // Maps track index to input device

    // Add input selectors to elements
    this.elements.inputSelectors = document.querySelectorAll(".input-selector");

    // Enhanced input handling
    this.inputStreams = new Map(); // Store active input streams
    this.inputMonitors = new Map(); // Store input monitoring nodes
    this.inputLevels = new Map(); // Store input level data
    this.deviceErrors = new Map(); // Track device errors

    // Add monitoring state
    this.isMonitoring = false;

    // Add output handling
    this.availableOutputs = [];
    this.currentOutput = null;

    // Add settings modal elements
    this.elements.settingsButton = document.querySelector(".settings-button");
    this.elements.settingsModal = document.getElementById("settings-modal");
    this.elements.closeSettings = document.querySelector(".close-settings");
    this.elements.outputSelector = document.getElementById("output-selector");

    this.initializeEventListeners();
    this.initializeTimescale();
    this.initializeBPMControl();
    this.initializeDisplayModeSwitch();

    // Initialize audio inputs
    this.initializeAudioInputs();

    // Add performance monitoring
    this.recordingMonitor = new RecordingMonitor();

    // Initialize settings
    this.initializeSettings();
  }

  // Initialize all event listeners
  initializeEventListeners() {
    // Transport controls
    this.elements.playButton.addEventListener("click", () => this.handlePlay());
    this.elements.stopButton.addEventListener("click", () => this.handleStop());
    this.elements.recordButton.addEventListener("click", () =>
      this.handleRecord()
    );

    // Drag and drop
    this.elements.clips.forEach((clip) => {
      clip.addEventListener("dragstart", (e) => this.handleDragStart(e));
      clip.addEventListener("dragend", (e) => this.handleDragEnd(e));
    });

    this.elements.tracks.forEach((track) => {
      track.addEventListener("dragover", (e) => this.handleDragOver(e));
      track.addEventListener("drop", (e) => this.handleDrop(e));
    });

    // Mixer controls
    this.elements.faders.forEach((fader) => {
      fader.addEventListener("input", (e) => this.handleVolumeChange(e));
    });

    this.elements.tracksContainer.addEventListener("click", (e) =>
      this.handleTimelineClick(e)
    );

    // Add playhead drag handlers
    this.elements.playheadLine.addEventListener("mousedown", (e) =>
      this.handlePlayheadDragStart(e)
    );
    this.elements.playheadCaret.addEventListener("mousedown", (e) =>
      this.handlePlayheadDragStart(e)
    );

    // Add document-level mouse move and up handlers for smooth dragging
    document.addEventListener("mousemove", (e) => this.handlePlayheadDrag(e));
    document.addEventListener("mouseup", () => this.handlePlayheadDragEnd());

    // Modify existing timeline click handler to ignore clicks on playhead
    this.elements.tracksContainer.addEventListener("click", (e) => {
      if (
        e.target !== this.elements.playheadLine &&
        e.target !== this.elements.playheadCaret
      ) {
        this.handleTimelineClick(e);
      }
    });

    this.initializeArmButtons();

    // Add input selector event listeners
    this.elements.inputSelectors.forEach((selector, index) => {
      selector.addEventListener("change", (e) => {
        this.handleInputChange(index, e.target.value);
      });
    });
  }

  // Audio setup methods
  async setupAudio() {
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      // Create media recorder for each armed track
      const recorders = [];

      for (const trackIndex of this.armedTracks) {
        const deviceId = this.trackInputs.get(trackIndex) || "default";

        // Reuse existing stream if available
        let stream = this.inputStreams.get(trackIndex);

        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: deviceId },
              autoGainControl: false,
              echoCancellation: false,
              noiseSuppression: false,
            },
          });
        }

        const recorder = new MediaRecorder(stream);
        recorder.trackIndex = trackIndex;
        recorder.audioChunks = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recorder.audioChunks.push(event.data);
          }
        };

        recorder.onstop = async () => {
          if (recorder.audioChunks.length > 0) {
            await this.processRecording();
          }
        };

        recorders.push(recorder);
      }

      this.mediaRecorders = recorders;
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Unable to access microphone. Please check permissions.");
    }
  }

  async reconnectRecorder(trackIndex) {
    try {
      const deviceId = this.trackInputs.get(trackIndex) || "default";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });

      // Replace the old recorder
      const index = this.mediaRecorders.findIndex(
        (r) => r.trackIndex === trackIndex
      );
      if (index !== -1) {
        this.mediaRecorders[index].stream
          .getTracks()
          .forEach((track) => track.stop());
        const newRecorder = new MediaRecorder(stream);
        newRecorder.trackIndex = trackIndex;
        newRecorder.audioChunks = [];
        this.mediaRecorders[index] = newRecorder;
      }
    } catch (err) {
      console.error("Failed to reconnect recorder:", err);
    }
  }

  // Update volume meter animation
  startVolumeMeter() {
    const updateMeters = () => {
      if (!this.analyser) return;

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      // Update all meters
      this.elements.meterFills.forEach((meterFill) => {
        const volume = Math.min(
          100,
          Math.round((dataArray.reduce((a, b) => a + b) / dataArray.length) * 2)
        );
        meterFill.style.width = `${volume}%`;
      });

      requestAnimationFrame(updateMeters);
    };

    updateMeters();
  }

  // Recording handlers
  async handleRecord() {
    if (!this.isRecording) {
      // Cleanup any existing recorders before creating new ones
      this.cleanupRecorders();
      await this.setupAudio();
      this.startRecording();
    } else {
      this.stopRecording();
    }
  }

  startRecording() {
    if (this.armedTracks.size === 0) {
      alert("Please arm at least one track to record");
      return;
    }

    this.isRecording = true;
    this.elements.recordButton.classList.add("active");

    // Create new clips for each armed track
    this.recordingTracks = [];
    this.recordingClips = [];

    // Get all timeline tracks
    const timelineTracks = Array.from(this.elements.tracks);

    this.armedTracks.forEach(() => {
      // Find first available track
      const availableTrack = this.findFirstAvailableTrack(timelineTracks);
      if (!availableTrack) {
        console.warn("No available tracks for recording");
        return;
      }

      const clip = document.createElement("div");
      clip.className = "clip recording";

      const nameContainer = document.createElement("div");
      nameContainer.className = "clip-name";
      nameContainer.textContent = `Recording ${this.clipCounter}`;
      clip.appendChild(nameContainer);

      clip.draggable = true;
      clip.style.left = `${this.playheadPosition}px`;
      clip.style.width = "0px";
      availableTrack.appendChild(clip);

      this.recordingTracks.push(availableTrack);
      this.recordingClips.push(clip);
    });

    const startTime = Date.now();

    // Animate clip width during recording
    const updateWidth = () => {
      if (this.isRecording) {
        const elapsed = Date.now() - startTime;
        this.recordingClips.forEach((clip) => {
          clip.style.width = `${elapsed / 10}px`;
        });
        requestAnimationFrame(updateWidth);
      }
    };

    updateWidth();

    // Start all recorders
    this.mediaRecorders.forEach((recorder) => {
      recorder.start();
    });
  }

  stopRecording() {
    this.isRecording = false;
    this.elements.recordButton.classList.remove("active");

    // Stop all recorders
    this.mediaRecorders.forEach((recorder) => {
      if (recorder.state === "recording") {
        recorder.stop();
      }
    });

    this.recordingClips.forEach((clip) => {
      clip.classList.remove("recording");
    });
  }

  async processRecording() {
    // Process each recording separately
    for (let i = 0; i < this.mediaRecorders.length; i++) {
      const recorder = this.mediaRecorders[i];
      const clip = this.recordingClips[i];

      if (recorder.audioChunks.length === 0) continue;

      const audioBlob = new Blob(recorder.audioChunks, {
        type: "audio/webm",
      });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      try {
        // Create waveform visualization
        const audioBuffer = await this.audioContext.decodeAudioData(
          await audioBlob.arrayBuffer()
        );
        const canvas = document.createElement("canvas");
        this.drawWaveform(audioBuffer, canvas);

        // Set the output device if one is selected
        if (this.currentOutput && audio.setSinkId) {
          await audio.setSinkId(this.currentOutput);
        }

        clip.appendChild(canvas);
        clip.audioElement = audio;
        clip.addEventListener("dragstart", (e) => this.handleDragStart(e));
        clip.addEventListener("dragend", (e) => this.handleDragEnd(e));
      } catch (err) {
        console.error("Error processing recording:", err);
      }
    }

    this.clipCounter++;
  }

  // Waveform visualization
  drawWaveform(audioBuffer, canvas) {
    // Set canvas size to match clip content area
    canvas.width = this.recordingClips[0].clientWidth;
    canvas.height = 40; // Height for waveform

    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";

    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;

      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }

      context.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }
  }

  // Playback handlers
  handlePlay() {
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.startTime =
        Date.now() - (this.playheadPosition / this.pixelsPerSecond) * 1000;
      this.updateTime();

      // Play all audio clips
      document.querySelectorAll(".clip").forEach((clip) => {
        if (clip.audioElement) {
          const clipStartTime =
            parseInt(clip.style.left) / this.pixelsPerSecond;
          const currentTime = this.playheadPosition / this.pixelsPerSecond;

          if (currentTime < clipStartTime) {
            // Clip hasn't started yet
            setTimeout(() => {
              clip.audioElement.play();
            }, (clipStartTime - currentTime) * 1000);
          } else {
            // Clip should already be playing
            clip.audioElement.currentTime = currentTime - clipStartTime;
            clip.audioElement.play();
          }
        }
      });
    }
  }

  handleStop() {
    this.isPlaying = false;
    this.startTime = 0;
    this.playheadPosition = 0;
    this.updatePlayhead();

    // Set initial display based on mode
    if (this.displayMode === "beats") {
      this.elements.timeDisplay.textContent = "1:1:0";
    } else {
      this.elements.timeDisplay.textContent = "00:00:00";
    }

    // Stop all audio clips
    document.querySelectorAll(".clip").forEach((clip) => {
      if (clip.audioElement) {
        clip.audioElement.pause();
        clip.audioElement.currentTime = 0;
      }
    });

    // Add cleanup on stop
    this.cleanupRecorders();
  }

  updateTime() {
    if (!this.isPlaying) {
      this.updateTimeDisplay();
      return;
    }

    // When playing, update based on elapsed time
    const elapsed = Date.now() - this.startTime;

    // Update playhead position
    this.playheadPosition = (elapsed / 1000) * this.pixelsPerSecond;
    this.updatePlayhead();
    this.updateTimeDisplay();

    requestAnimationFrame(() => this.updateTime());
  }

  // Drag and drop handlers
  handleDragStart(e) {
    this.draggedClip = e.target;
    this.dragOffset = e.clientX - this.draggedClip.offsetLeft;
    this.draggedClip.classList.add("dragging");
  }

  handleDragEnd(e) {
    this.draggedClip.classList.remove("dragging");
    this.draggedClip = null;
  }

  handleDragOver(e) {
    e.preventDefault();
    if (this.draggedClip) {
      const rect = e.target.getBoundingClientRect();
      const newLeft = Math.max(0, e.clientX - rect.left - this.dragOffset);
      this.draggedClip.style.left = `${newLeft}px`;
    }
  }

  handleDrop(e) {
    e.preventDefault();
    if (this.draggedClip) {
      const rect = e.target.getBoundingClientRect();
      const newLeft = Math.max(0, e.clientX - rect.left - this.dragOffset);
      this.draggedClip.style.left = `${newLeft}px`;
      e.target.appendChild(this.draggedClip);
    }
  }

  // Mixer handlers
  handleVolumeChange(e) {
    const value = e.target.value;
    e.target.parentElement.querySelector(
      "div:last-child"
    ).textContent = `Volume: ${value}%`;

    // If the clip has an audio element, update its volume
    const trackIndex = Array.from(this.elements.faders).indexOf(e.target);
    const track = this.elements.tracks[trackIndex];
    if (track) {
      track.querySelectorAll(".clip").forEach((clip) => {
        if (clip.audioElement) {
          clip.audioElement.volume = value / 100;
        }
      });
    }
  }

  initializeTimescale() {
    const ctx = this.elements.timescaleCanvas.getContext("2d");
    const width = this.elements.timescaleCanvas.parentElement.clientWidth;
    const height = 30;

    this.elements.timescaleCanvas.width = width;
    this.elements.timescaleCanvas.height = height;

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, width, height);

    // Calculate beat positions
    const pixelsPerBeat = this.pixelsPerSecond * (60 / this.bpm);
    const pixelsPerBar = pixelsPerBeat * this.beatsPerBar;

    // Draw bars and beats
    for (let x = 0; x < width; x += pixelsPerBar) {
      // Draw bar line (stronger)
      ctx.strokeStyle = "#666";
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(x, 0);
      ctx.stroke();

      // Calculate bar number (starting from 1)
      const barNumber = Math.floor(x / pixelsPerBar) + 1;

      // Draw bar number
      ctx.fillStyle = "#fff";
      ctx.font = "10px Arial";
      ctx.fillText(barNumber.toString(), x + 4, height - 15);

      // Draw beat lines (weaker)
      ctx.strokeStyle = "#444";
      for (let beat = 1; beat < this.beatsPerBar; beat++) {
        const beatX = x + beat * pixelsPerBeat;
        ctx.beginPath();
        ctx.moveTo(beatX, height);
        ctx.lineTo(beatX, 5);
        ctx.stroke();

        // Draw beat number
        const beatNumber = beat + 1;
        ctx.fillStyle = "#666";
        ctx.font = "9px Arial";
        ctx.fillText(beatNumber.toString(), beatX + 2, height - 5);
      }
    }
  }

  handleTimelineClick(e) {
    const rect = this.elements.tracksContainer.getBoundingClientRect();
    const clickX =
      e.clientX - rect.left + this.elements.tracksContainer.scrollLeft;
    this.playheadPosition = clickX;
    this.updatePlayhead();
    this.updateTimeDisplay();

    // If playing, update the start time to maintain correct playback
    if (this.isPlaying) {
      this.startTime =
        Date.now() - (this.playheadPosition / this.pixelsPerSecond) * 1000;
    }
  }

  updatePlayhead() {
    requestAnimationFrame(() => {
      this.elements.playheadContainer.style.left = `${this.playheadPosition}px`;
    });
  }

  handlePlayheadDragStart(e) {
    e.preventDefault();
    this.isDraggingPlayhead = true;
    this.playheadDragStartX = e.clientX - this.playheadPosition;
    this.elements.playheadLine.style.cursor = "grabbing";
    this.elements.playheadCaret.style.cursor = "grabbing";
  }

  handlePlayheadDrag(e) {
    if (!this.isDraggingPlayhead) return;

    const rect = this.elements.tracksContainer.getBoundingClientRect();
    const containerScrollLeft = this.elements.tracksContainer.scrollLeft;

    // Calculate new position considering scroll offset
    let newPosition = e.clientX - this.playheadDragStartX;
    newPosition = Math.max(0, newPosition);

    this.playheadPosition = newPosition;
    this.updatePlayhead();
    this.updateTimeDisplay();

    // If playing, update the start time to maintain correct playback
    if (this.isPlaying) {
      this.startTime =
        Date.now() - (this.playheadPosition / this.pixelsPerSecond) * 1000;
    }
  }

  handlePlayheadDragEnd() {
    if (!this.isDraggingPlayhead) return;

    this.isDraggingPlayhead = false;
    this.elements.playheadLine.style.cursor = "grab";
    this.elements.playheadCaret.style.cursor = "grab";
  }

  updateGrid() {
    const secondsPerBeat = 60 / this.bpm;
    const pixelsPerBeat = this.pixelsPerSecond * secondsPerBeat;
    const pixelsPerBar = pixelsPerBeat * this.beatsPerBar;

    // Update CSS grid sizes
    const gridStyle = `
      linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
    `;
    const gridSize = `${pixelsPerBar}px 100%, ${pixelsPerBeat}px 100%`;

    this.elements.tracksContainer.style.backgroundImage = gridStyle;
    this.elements.tracksContainer.style.backgroundSize = gridSize;
    this.elements.timescale.style.backgroundImage = gridStyle;
    this.elements.timescale.style.backgroundSize = gridSize;

    // Redraw timescale
    this.initializeTimescale();
  }

  initializeBPMControl() {
    // Set initial value
    this.elements.bpmInput.value = this.bpm;

    // Add event listeners for BPM changes
    this.elements.bpmInput.addEventListener("change", (e) => {
      const newBPM = Math.min(
        300,
        Math.max(20, parseInt(e.target.value) || 120)
      );
      this.elements.bpmInput.value = newBPM;
      this.bpm = newBPM;
      this.pixelsPerBeat = this.pixelsPerSecond * (60 / this.bpm);
      this.updateGrid();
    });

    // Add input event for live updates while typing
    this.elements.bpmInput.addEventListener("input", (e) => {
      const newBPM = Math.min(
        300,
        Math.max(20, parseInt(e.target.value) || 120)
      );
      this.bpm = newBPM;
      this.pixelsPerBeat = this.pixelsPerSecond * (60 / this.bpm);
      this.updateGrid();
    });
  }

  initializeDisplayModeSwitch() {
    const segments = document.querySelectorAll(".segment");

    segments.forEach((segment) => {
      segment.addEventListener("click", () => {
        // Remove active class from all segments
        segments.forEach((s) => s.classList.remove("active"));

        // Add active class to clicked segment
        segment.classList.add("active");

        // Update display mode
        this.displayMode = segment.dataset.mode;
        this.updateTimeDisplay();
      });
    });
  }

  // Update the time display method to handle both modes
  updateTimeDisplay() {
    if (this.displayMode === "beats") {
      const totalBeats =
        this.playheadPosition / (this.pixelsPerSecond * (60 / this.bpm));
      const bars = Math.floor(totalBeats / this.beatsPerBar) + 1;
      const beats = Math.floor(totalBeats % this.beatsPerBar) + 1;
      const subBeats = Math.floor((totalBeats % 1) * 4);

      this.elements.timeDisplay.textContent =
        `${bars}:${beats}:${subBeats}`.padStart(5, "0");
    } else {
      // Time mode (minutes:seconds:milliseconds)
      const totalSeconds = this.playheadPosition / this.pixelsPerSecond;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const milliseconds = Math.floor((totalSeconds % 1) * 100);

      this.elements.timeDisplay.textContent = `${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}:${milliseconds
        .toString()
        .padStart(2, "0")}`;
    }
  }

  // Add new method to initialize arm buttons
  initializeArmButtons() {
    this.elements.armButtons.forEach((button, index) => {
      button.addEventListener("click", () => {
        button.classList.toggle("armed");
        const trackIndex = index;

        if (button.classList.contains("armed")) {
          this.armedTracks.add(trackIndex);
        } else {
          this.armedTracks.delete(trackIndex);
        }
      });
    });
  }

  // Add new method to initialize audio inputs
  async initializeAudioInputs() {
    try {
      // Request initial permission to get complete device list
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Now get the complete list of devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.availableInputs = devices.filter(
        (device) => device.kind === "audioinput"
      );

      // Update the selectors with the complete device list
      await this.updateInputSelectors();

      // Listen for device changes
      navigator.mediaDevices.addEventListener("devicechange", async () => {
        await this.handleDeviceChange();
      });
    } catch (err) {
      console.error("Error getting audio inputs:", err);
      alert("Please grant microphone permissions to see available inputs");
    }
  }

  // Add new method to update input selectors
  async updateInputSelectors() {
    this.elements.inputSelectors.forEach((selector) => {
      // Store current selection
      const currentValue = selector.value;

      // Clear existing options
      selector.innerHTML = "";

      // Add "None" option
      const noneOption = document.createElement("option");
      noneOption.value = "none";
      noneOption.text = "None";
      selector.appendChild(noneOption);

      // Add available inputs
      this.availableInputs.forEach((input) => {
        const option = document.createElement("option");
        option.value = input.deviceId;

        // Format the label nicely
        if (input.deviceId === "default") {
          option.text = "System Default";
        } else if (input.label) {
          // Clean up common device label formats
          let label = input.label;
          label = label.replace(" (Built-in)", "");
          label = label.replace(" (Default)", "");
          label = label.replace(/\([0-9a-f]{4}:[0-9a-f]{4}\)/i, "");
          label = label.trim();
          option.text = label;
        } else {
          option.text = `Input ${this.availableInputs.indexOf(input) + 1}`;
        }

        selector.appendChild(option);
      });

      // Restore previous selection if it still exists
      if (
        this.availableInputs.find((device) => device.deviceId === currentValue)
      ) {
        selector.value = currentValue;
      }
    });
  }

  // Add method to handle input changes
  async handleInputChange(trackIndex, deviceId) {
    this.trackInputs.set(trackIndex, deviceId);

    // Setup monitoring for new device
    if (deviceId !== "none") {
      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      await this.setupInputMonitoring(trackIndex, deviceId);
    } else {
      this.cleanupInputMonitoring(trackIndex);
    }

    this.updateInputUIState(trackIndex, true);
  }

  // Add method to update input UI state
  updateInputUIState(trackIndex, isWorking) {
    const channel = this.elements.mixer.querySelector(
      `.mixer-channel:nth-child(${trackIndex + 1})`
    );
    if (!channel) return;

    const selector = channel.querySelector(".input-selector");
    const error = this.deviceErrors.get(trackIndex);

    if (error) {
      selector.classList.add("error");
      selector.title = error;
    } else {
      selector.classList.remove("error");
      selector.title = "";
    }

    // Update arm button state
    const armButton = channel.querySelector(".arm-button");
    armButton.disabled = !isWorking;
  }

  // Add new method for input monitoring
  async setupInputMonitoring(trackIndex, deviceId) {
    try {
      // Cleanup existing monitoring for this track
      this.cleanupInputMonitoring(trackIndex);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });

      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;

      // Create gain node for monitoring level
      const monitorGain = this.audioContext.createGain();
      monitorGain.gain.value = 0; // Start muted

      // Connect nodes
      source.connect(analyser);
      analyser.connect(monitorGain);
      monitorGain.connect(this.audioContext.destination);

      // Store references
      this.inputStreams.set(trackIndex, stream);
      this.inputMonitors.set(trackIndex, {
        source,
        analyser,
        gain: monitorGain,
      });

      // Start level monitoring for this track
      this.monitorInputLevel(trackIndex, analyser);

      // Clear any previous errors
      this.deviceErrors.delete(trackIndex);
      this.updateInputUIState(trackIndex, true);
    } catch (err) {
      console.error(
        `Error setting up input monitoring for track ${trackIndex}:`,
        err
      );
      this.deviceErrors.set(trackIndex, err.message);
      this.updateInputUIState(trackIndex, false);
    }
  }

  // Add method to cleanup input monitoring
  cleanupInputMonitoring(trackIndex) {
    // Cleanup stream
    const stream = this.inputStreams.get(trackIndex);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      this.inputStreams.delete(trackIndex);
    }

    // Cleanup monitor nodes
    const monitor = this.inputMonitors.get(trackIndex);
    if (monitor) {
      monitor.source.disconnect();
      monitor.analyser.disconnect();
      monitor.gain.disconnect();
      this.inputMonitors.delete(trackIndex);
    }

    // Clear level data
    this.inputLevels.delete(trackIndex);
  }

  // Add method to monitor input levels
  monitorInputLevel(trackIndex, analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const meterFill = this.elements.meterFills[trackIndex];

    const updateLevel = () => {
      if (!this.inputMonitors.has(trackIndex)) return;

      analyser.getByteFrequencyData(dataArray);

      // Calculate RMS value for more accurate level measurement
      let rms = 0;
      for (let i = 0; i < dataArray.length; i++) {
        rms += (dataArray[i] / 255.0) ** 2;
      }
      rms = Math.sqrt(rms / dataArray.length);

      // Convert to percentage with some headroom
      const level = Math.min(100, Math.round(rms * 150));

      if (meterFill) {
        meterFill.style.width = `${level}%`;
      }

      requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }

  // Add method to update input meter in UI
  updateInputMeter(trackIndex, level) {
    const channel = this.elements.mixer.querySelector(
      `.mixer-channel:nth-child(${trackIndex + 1})`
    );
    if (!channel) return;

    let meter = channel.querySelector(".input-meter");

    if (!meter) {
      // Create meter if it doesn't exist
      meter = document.createElement("div");
      meter.className = "input-meter";
      meter.innerHTML = '<div class="input-meter-fill"></div>';
      channel.querySelector(".channel-controls").prepend(meter);
    }

    meter.querySelector(".input-meter-fill").style.width = `${level}%`;
  }

  // Add cleanup method
  cleanupRecorders() {
    if (this.mediaRecorders) {
      this.mediaRecorders.forEach((recorder) => {
        // Stop all tracks in the stream
        recorder.stream.getTracks().forEach((track) => track.stop());
        // Clear chunks array
        recorder.audioChunks = [];
      });
      this.mediaRecorders = null;
    }
  }

  async handleDeviceChange() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(
        (device) => device.kind === "audioinput"
      );

      // Check if any active devices were disconnected
      this.trackInputs.forEach((deviceId, trackIndex) => {
        if (
          deviceId !== "none" &&
          !audioInputs.find((device) => device.deviceId === deviceId)
        ) {
          // Device was disconnected, switch to no input
          this.trackInputs.set(trackIndex, "none");
          this.cleanupInputMonitoring(trackIndex);
        }
      });

      // Update available inputs list
      this.availableInputs = audioInputs;
      await this.updateInputSelectors();
    } catch (err) {
      console.error("Error handling device change:", err);
    }
  }

  handleLargeRecording(trackIndex) {
    // Notify user
    console.warn(`Recording on track ${trackIndex} is getting large`);

    // Optionally, implement automatic splitting or cleanup
    // This could involve creating a new clip and starting fresh
  }

  initializeSettings() {
    // Add settings button listener
    this.elements.settingsButton.addEventListener("click", () => {
      this.elements.settingsModal.classList.add("show");
    });

    // Add close button listener
    this.elements.closeSettings.addEventListener("click", () => {
      this.elements.settingsModal.classList.remove("show");
    });

    // Close modal when clicking outside
    this.elements.settingsModal.addEventListener("click", (e) => {
      if (e.target === this.elements.settingsModal) {
        this.elements.settingsModal.classList.remove("show");
      }
    });

    // Add system settings button listener
    const openSystemSettings = document.getElementById("open-system-settings");
    if (openSystemSettings) {
      openSystemSettings.addEventListener("click", () => {
        // Show instructions based on the operating system
        const os = navigator.platform.toLowerCase();
        let instructions = "";

        if (os.includes("win")) {
          instructions =
            'Windows: Right-click the speaker icon in your taskbar and select "Sound settings"';
        } else if (os.includes("mac")) {
          instructions =
            'macOS: Click the Apple menu and select "System Settings > Sound"';
        } else {
          instructions =
            "Please open your system's sound settings to change the audio output device";
        }

        alert(instructions);
      });
    }
  }

  // Add new method to find first available track
  findFirstAvailableTrack(tracks) {
    const currentTime = this.playheadPosition / this.pixelsPerSecond;

    // Try each track until we find one with no conflicts
    for (const track of tracks) {
      const hasConflict = Array.from(track.children).some((clip) => {
        if (!clip.classList.contains("clip")) return false;

        const clipLeft = parseInt(clip.style.left) || 0;
        const clipWidth = parseInt(clip.style.width) || 0;
        const clipStartTime = clipLeft / this.pixelsPerSecond;
        const clipEndTime = (clipLeft + clipWidth) / this.pixelsPerSecond;

        // Check if current time falls within this clip's time range
        return currentTime >= clipStartTime && currentTime <= clipEndTime;
      });

      if (!hasConflict) {
        return track;
      }
    }

    return null;
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const audioEditor = new AudioEditor();
});

// Add performance monitoring
class RecordingMonitor {
  constructor() {
    this.metrics = new Map();
  }

  startTrackMonitoring(trackIndex) {
    this.metrics.set(trackIndex, {
      startTime: performance.now(),
      chunks: 0,
      totalSize: 0,
      lastUpdate: performance.now(),
    });
  }

  updateMetrics(trackIndex, chunkSize) {
    const metric = this.metrics.get(trackIndex);
    if (metric) {
      metric.chunks++;
      metric.totalSize += chunkSize;
      metric.lastUpdate = performance.now();
    }
  }

  getTrackMetrics(trackIndex) {
    const metric = this.metrics.get(trackIndex);
    if (!metric) return null;

    const duration = performance.now() - metric.startTime;
    return {
      duration,
      chunks: metric.chunks,
      averageChunkSize: metric.totalSize / metric.chunks,
      dataRate: (metric.totalSize / duration) * 1000, // bytes per second
      timeSinceLastChunk: performance.now() - metric.lastUpdate,
    };
  }
}
