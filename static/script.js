(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const canvas = $('#game-canvas');
  const ctx = canvas.getContext('2d');
  const audioInput = $('#audio-file');
  const imageInput = $('#image-file');
  const gameCard = $('.game-card');
  const playfield = $('#playfield');
  const laneKeys = $('#lane-keys');
  const laneKeyElements = [...document.querySelectorAll('.lane-key')];
  const spaceKeyElements = [...document.querySelectorAll('.space-key')];
  const keyFlashTimers = new Map();
  const audio = new Audio();
  audio.preload = 'metadata';

  const state = {
    context: null,
    source: null,
    analyser: null,
    audioBuffer: null,
    objectUrl: null,
    imageUrl: null,
    notes: [],
    speed: 1.5,
    difficulty: 'easy',
    running: false,
    score: 0,
    combo: 0,
    best: Number(localStorage.getItem('neon-best-score') || 0),
    lastFrame: 0,
    toastTimer: 0,
    judgeTimer: 0,
    pointerDown: new Map(),
    audioEnded: false,
  };

  $('#best').textContent = formatScore(state.best);

  function formatScore(value) {
    return Math.max(0, Math.floor(value)).toString().padStart(7, '0');
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '00:00';
    const safe = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function isLightTheme() {
    return document.body.dataset.theme === 'light';
  }

  function judgeColor(grade) {
    const light = isLightTheme();
    return {
      PERFECT: light ? '#7c47c9' : '#d8aaff',
      GREAT: light ? '#118a99' : '#8fe8ee',
      GOOD: light ? '#a06a00' : '#ffe09b',
      MISS: light ? '#c93d6b' : '#ff8bb0',
      HOLD: light ? '#118a99' : '#8fe8ee',
    }[grade];
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function setTheme(theme) {
    document.body.dataset.theme = theme;
    document.querySelectorAll('.theme-option').forEach((button) => {
      button.classList.toggle('active', button.dataset.themeChoice === theme);
    });
    localStorage.setItem('neon-theme', theme);
  }

  document.querySelectorAll('.theme-option').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });
  setTheme(localStorage.getItem('neon-theme') || 'dark');

  document.querySelectorAll('.speed-choice').forEach((button) => {
    button.addEventListener('click', () => {
      state.speed = Number(button.dataset.speed);
      audio.playbackRate = state.speed;
      document.querySelectorAll('.speed-choice').forEach((item) => item.classList.toggle('active', item === button));
      showToast(`再生速度 ${state.speed.toFixed(1)}×`);
    });
  });

  document.querySelectorAll('.difficulty-choice').forEach((button) => {
    button.addEventListener('click', () => {
      state.difficulty = button.dataset.difficulty;
      document.querySelectorAll('.difficulty-choice').forEach((item) => item.classList.toggle('active', item === button));
      if (state.audioBuffer) {
        generateChart(state.audioBuffer);
        showToast(`${difficultyName()} の譜面に更新しました`);
      }
    });
  });

  function difficultyName() {
    return { easy: '簡単', normal: '普通', hard: '難しい' }[state.difficulty];
  }

  document.querySelectorAll('.background-choice[data-background]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.background-choice[data-background]').forEach((item) => item.classList.toggle('active', item === button));
      gameCard.dataset.background = button.dataset.background;
      gameCard.classList.remove('custom-background');
      $('.stage-background').style.backgroundImage = '';
      $('#clear-bg').hidden = true;
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = null;
    });
  });

  $('#clear-bg').addEventListener('click', () => {
    document.querySelector('.background-choice[data-background="aurora"]').click();
  });

  imageInput.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(file);
    gameCard.classList.add('custom-background');
    gameCard.style.setProperty('--custom-stage-image', `url("${state.imageUrl}")`);
    document.querySelectorAll('.background-choice[data-background]').forEach((item) => item.classList.remove('active'));
    $('#clear-bg').hidden = false;
    imageInput.value = '';
  });

  const dropZone = $('#audio-drop');
  ['dragenter', 'dragover'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  }));
  dropZone.addEventListener('drop', (event) => {
    const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('audio/'));
    if (file) loadAudio(file);
  });

  audioInput.addEventListener('change', () => {
    const file = audioInput.files && audioInput.files[0];
    if (file) loadAudio(file);
  });

  async function loadAudio(file) {
    if (!file.type.startsWith('audio/')) {
      showToast('音声ファイルを選択してください');
      return;
    }
    $('#audio-title').textContent = file.name;
    $('#audio-subtitle').textContent = '読み込み中…';
    $('#track-label').textContent = file.name.toUpperCase();
    $('#play-button').disabled = true;
    $('#stage-empty').classList.remove('hidden');
    state.running = false;
    audio.pause();
    audio.currentTime = 0;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    audio.src = state.objectUrl;
    audio.playbackRate = state.speed;
    state.audioEnded = false;

    try {
      if (!state.context) state.context = new (window.AudioContext || window.webkitAudioContext)();
      if (state.context.state === 'suspended') await state.context.resume();
      const buffer = await file.arrayBuffer();
      state.audioBuffer = await state.context.decodeAudioData(buffer);
      generateChart(state.audioBuffer);
      $('#duration').textContent = formatTime(state.audioBuffer.duration / state.speed);
      $('#current-time').textContent = '00:00';
      $('#progress-fill').style.width = '0%';
      $('#audio-subtitle').textContent = `${formatTime(state.audioBuffer.duration)} · ${difficultyName()} の譜面を生成`;
      $('#play-button').disabled = false;
      state.score = 0;
      state.combo = 0;
      updateHud();
      showToast(`${state.notes.length} 個のノーツを生成しました`);
    } catch (error) {
      console.error(error);
      $('#audio-subtitle').textContent = 'この音声形式は読み込めませんでした';
      $('#play-button').disabled = false;
      showToast('音声の読み込みに失敗しました。別の形式をお試しください');
    }
  }

  function generateChart(buffer) {
    const sampleRate = buffer.sampleRate;
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
    }

    const windowSize = 1024;
    const hopSize = 256;
    const energies = [];
    for (let start = 0; start + windowSize < mono.length; start += hopSize) {
      let energy = 0;
      for (let index = start; index < start + windowSize; index += 4) energy += mono[index] * mono[index];
      energies.push({ time: start / sampleRate, energy: Math.sqrt(energy / (windowSize / 4)) });
    }

    const radius = 12;
    const raw = [];
    for (let index = radius; index < energies.length - radius; index += 1) {
      const current = energies[index];
      let mean = 0;
      for (let offset = -radius; offset <= radius; offset += 1) mean += energies[index + offset].energy;
      mean /= radius * 2 + 1;
      const threshold = mean * (state.difficulty === 'easy' ? 1.42 : state.difficulty === 'normal' ? 1.23 : 1.09);
      if (current.energy > threshold && current.energy > 0.014) {
        if (!raw.length || current.time - raw[raw.length - 1].time > (state.difficulty === 'hard' ? 0.13 : state.difficulty === 'normal' ? 0.20 : 0.29)) {
          raw.push({ time: current.time, energy: current.energy });
        } else if (current.energy > raw[raw.length - 1].energy) {
          raw[raw.length - 1] = { time: current.time, energy: current.energy };
        }
      }
    }

    const minGap = state.difficulty === 'easy' ? 0.45 : state.difficulty === 'normal' ? 0.30 : 0.19;
    const targetCount = Math.max(1, Math.round(buffer.duration * (state.difficulty === 'easy' ? 1.05 : state.difficulty === 'normal' ? 1.7 : 2.6)));
    const candidates = raw.length > targetCount * 1.9
      ? raw.filter((note, index) => index === 0 || index === raw.length - 1 || index % Math.ceil(raw.length / (targetCount * 1.7)) === 0)
      : raw;
    const selected = [];
    for (const note of candidates) {
      if (note.time < 0.35 || note.time > buffer.duration - 0.18) continue;
      if (selected.length && note.time - selected[selected.length - 1].time < minGap) continue;
      selected.push(note);
    }

    if (selected.length < Math.min(4, Math.floor(buffer.duration / 1.2))) {
      const fallbackGap = state.difficulty === 'easy' ? 1.25 : state.difficulty === 'normal' ? 0.8 : 0.55;
      const existing = selected.map((note) => note.time);
      for (let time = 0.7; time < buffer.duration - 0.3; time += fallbackGap) {
        if (existing.every((point) => Math.abs(point - time) > minGap * 0.65)) selected.push({ time, energy: 0.18, synthetic: true });
      }
      selected.sort((a, b) => a.time - b.time);
    }

    const laneCount = state.difficulty === 'easy' ? 3 : 4;
    state.notes = selected.map((note, index) => ({
      time: note.time,
      lane: Math.floor((note.time * 2.27 + index * 1.71) % laneCount),
      energy: note.energy,
      long: state.difficulty !== 'easy' && index % (state.difficulty === 'hard' ? 7 : 10) === 4,
      judged: false,
      missed: false,
    }));
  }

  async function ensureAudioGraph() {
    if (!state.context) return;
    if (!state.source) {
      state.source = state.context.createMediaElementSource(audio);
      state.analyser = state.context.createAnalyser();
      state.analyser.fftSize = 128;
      state.analyser.smoothingTimeConstant = 0.78;
      state.source.connect(state.analyser);
      state.analyser.connect(state.context.destination);
    }
    if (state.context.state === 'suspended') await state.context.resume();
  }

  $('#play-button').addEventListener('click', async () => {
    if (!state.audioBuffer) {
      audioInput.click();
      return;
    }
    if (audio.paused) await startPlayback();
    else pausePlayback();
  });

  async function startPlayback() {
    if (!state.audioBuffer) return;
    await ensureAudioGraph();
    if (state.audioEnded || audio.currentTime >= audio.duration - 0.05) {
      audio.currentTime = 0;
      resetGame();
    }
    state.notes.forEach((note) => {
      if (note.time < audio.currentTime - 0.2) note.judged = true;
    });
    audio.playbackRate = state.speed;
    try {
      await audio.play();
      state.running = true;
      state.audioEnded = false;
      $('#stage-empty').classList.add('hidden');
      $('#play-label').textContent = 'PAUSE';
      $('.play-symbol').textContent = 'Ⅱ';
    } catch (error) {
      console.error(error);
      showToast('再生を開始できませんでした');
    }
  }

  function pausePlayback() {
    audio.pause();
    state.running = false;
    $('#play-label').textContent = 'RESUME';
    $('.play-symbol').textContent = '▶';
  }

  function resetGame() {
    audio.pause();
    audio.currentTime = 0;
    state.running = false;
    state.audioEnded = false;
    state.score = 0;
    state.combo = 0;
    state.notes.forEach((note) => {
      note.judged = false;
      note.missed = false;
    });
    $('#play-label').textContent = 'PLAY';
    $('.play-symbol').textContent = '▶';
    $('#stage-empty').classList.add('hidden');
    updateHud();
    $('#progress-fill').style.width = '0%';
    $('#current-time').textContent = '00:00';
  }

  $('#restart-button').addEventListener('click', () => {
    resetGame();
    showToast('最初からプレイできます');
  });

  audio.addEventListener('ended', () => {
    state.running = false;
    state.audioEnded = true;
    $('#play-label').textContent = 'AGAIN';
    $('.play-symbol').textContent = '▶';
    $('#stage-empty').classList.add('hidden');
    $('#judge-text').textContent = '音楽が終了しました。';
    $('#judge-text').classList.add('show');
    window.setTimeout(() => $('#judge-text').classList.remove('show'), 1800);
  });

  function updateHud() {
    $('#score').textContent = formatScore(state.score);
    $('#combo').textContent = String(state.combo);
    $('#best').textContent = formatScore(state.best);
  }

  function getLayout() {
    const width = playfield.clientWidth;
    const height = playfield.clientHeight;
    const centerX = width / 2;
    const horizonY = height * 0.31;
    const hitY = height * 0.80;
    const laneWidth = Math.min(width * 0.125, 76);
    const laneCount = state.difficulty === 'easy' ? 3 : 4;
    const stageWidth = laneWidth * laneCount;
    const perspectiveOffset = laneWidth * 0.52;
    return { width, height, centerX, horizonY, hitY, laneWidth, laneCount, stageWidth, perspectiveOffset };
  }

  function syncLaneKeyGuide(layout) {
    const laneWidth = `${layout.laneWidth}px`;
    const laneCount = String(layout.laneCount);
    if (laneKeys.style.getPropertyValue('--lane-width') !== laneWidth) laneKeys.style.setProperty('--lane-width', laneWidth);
    if (laneKeys.style.getPropertyValue('--lane-count') !== laneCount) laneKeys.style.setProperty('--lane-count', laneCount);
    if (laneKeys.dataset.laneCount !== laneCount) laneKeys.dataset.laneCount = laneCount;
  }

  function flashKeys(elements, id) {
    const active = elements.filter(Boolean);
    active.forEach((element) => element.classList.add('pressed'));
    window.clearTimeout(keyFlashTimers.get(id));
    keyFlashTimers.set(id, window.setTimeout(() => {
      active.forEach((element) => element.classList.remove('pressed'));
    }, 160));
  }

  function laneX(lane, progress, layout) {
    const farWidth = layout.laneWidth * 0.27;
    const nearWidth = layout.laneWidth;
    const xAtHorizon = layout.centerX - farWidth * layout.laneCount / 2 + (lane + 0.5) * farWidth;
    const xAtHit = layout.centerX - nearWidth * layout.laneCount / 2 + (lane + 0.5) * nearWidth;
    return xAtHorizon + (xAtHit - xAtHorizon) * progress;
  }

  function drawFrame(timestamp) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = playfield.clientWidth;
    const height = playfield.clientHeight;
    if (!width || !height) {
      requestAnimationFrame(drawFrame);
      return;
    }
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const layout = getLayout();
    syncLaneKeyGuide(layout);
    const light = isLightTheme();
    const now = audio.currentTime || 0;
    const travelTime = 2.35 / state.speed;
    const topY = layout.horizonY;
    const bottomY = layout.hitY;

    let pulse = 0;
    if (state.running && state.analyser) {
      const bins = new Uint8Array(state.analyser.frequencyBinCount);
      state.analyser.getByteFrequencyData(bins);
      pulse = bins.reduce((sum, value) => sum + value, 0) / bins.length / 255;
    }

    const glow = ctx.createRadialGradient(layout.centerX, bottomY, 0, layout.centerX, bottomY, width * 0.48);
    glow.addColorStop(0, light ? `rgba(122, 88, 196, ${0.1 + pulse * 0.08})` : `rgba(155, 113, 241, ${0.08 + pulse * 0.11})`);
    glow.addColorStop(1, light ? 'rgba(110, 160, 210, 0)' : 'rgba(80, 142, 190, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, topY, width, height - topY);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(layout.centerX - layout.perspectiveOffset, topY);
    ctx.lineTo(layout.centerX + layout.perspectiveOffset, topY);
    ctx.lineTo(layout.centerX + layout.stageWidth / 2, bottomY + 10);
    ctx.lineTo(layout.centerX - layout.stageWidth / 2, bottomY + 10);
    ctx.closePath();
    const floor = ctx.createLinearGradient(0, topY, 0, bottomY);
    floor.addColorStop(0, light ? 'rgba(133, 85, 214, .05)' : 'rgba(177, 143, 255, .025)');
    floor.addColorStop(1, light ? `rgba(104, 92, 190, ${.12 + pulse * .05})` : `rgba(118, 129, 219, ${.085 + pulse * .045})`);
    ctx.fillStyle = floor;
    ctx.fill();

    for (let lane = 0; lane <= layout.laneCount; lane += 1) {
      const x1 = layout.centerX - layout.perspectiveOffset + (layout.perspectiveOffset * 2 / layout.laneCount) * lane;
      const x2 = layout.centerX - layout.stageWidth / 2 + layout.laneWidth * lane;
      ctx.beginPath();
      ctx.moveTo(x1, topY);
      ctx.lineTo(x2, bottomY + 9);
      const edge = lane === 0 || lane === layout.laneCount;
      ctx.strokeStyle = light
        ? (edge ? 'rgba(103, 74, 165, .42)' : 'rgba(103, 74, 165, .26)')
        : (edge ? 'rgba(177, 159, 233, .3)' : 'rgba(194, 171, 255, .19)');
      ctx.lineWidth = edge ? 1.2 : 0.8;
      ctx.stroke();
    }

    for (let step = 1; step <= 8; step += 1) {
      const fraction = step / 8;
      const y = topY + (bottomY - topY) * fraction * fraction;
      const halfWidth = layout.perspectiveOffset + (layout.stageWidth / 2 - layout.perspectiveOffset) * fraction;
      ctx.beginPath();
      ctx.moveTo(layout.centerX - halfWidth, y);
      ctx.lineTo(layout.centerX + halfWidth, y);
      ctx.strokeStyle = light
        ? `rgba(103, 74, 165, ${0.08 + fraction * 0.05})`
        : `rgba(182, 159, 239, ${0.045 + fraction * 0.025})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.restore();

    for (const note of state.notes) {
      if (note.judged || note.missed) continue;
      const delta = note.time - now;
      if (delta > travelTime || delta < -0.18) continue;
      const progress = Math.max(0, Math.min(1, 1 - delta / travelTime));
      const depth = progress * progress;
      const y = topY + (bottomY - topY) * depth;
      const widthScale = 0.28 + 0.72 * progress;
      const noteWidth = layout.laneWidth * widthScale * (note.long ? 0.82 : 0.72);
      const noteHeight = (9 + 12 * progress) * (note.long ? 2 : 1);
      const x = laneX(note.lane, progress, layout);
      const color = note.lane % 2 === 0
        ? (light ? '#8555d6' : '#b58bff')
        : (light ? '#1598a8' : '#66dce5');
      const alpha = Math.max(0.3, Math.min(1, progress * 1.3));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 9 + progress * 15;
      ctx.shadowColor = color;
      if (note.long) {
        const tailProgress = Math.max(0, progress - 0.13);
        const tailY = topY + (bottomY - topY) * tailProgress * tailProgress;
        const tailX = laneX(note.lane, tailProgress, layout);
        ctx.fillStyle = `${color}30`;
        ctx.fillRect(tailX - noteWidth * .28, tailY, noteWidth * .56, y - tailY);
      }
      const radius = Math.max(2, 4 * progress);
      ctx.beginPath();
      ctx.roundRect(x - noteWidth / 2, y - noteHeight / 2, noteWidth, noteHeight, radius);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.roundRect(x - noteWidth / 2 + 1, y - noteHeight / 2 + 1, noteWidth - 2, Math.max(2, noteHeight * .34), radius);
      ctx.fillStyle = light ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.36)';
      ctx.fill();
      ctx.restore();
    }

    if (state.running) {
      for (const note of state.notes) {
        if (!note.judged && !note.missed && now - note.time > 0.18) {
          note.missed = true;
          registerMiss();
        }
      }
    }

    if (audio.duration && Number.isFinite(audio.duration)) {
      $('#progress-fill').style.width = `${Math.min(100, (now / audio.duration) * 100)}%`;
      $('#current-time').textContent = formatTime(now / state.speed);
    }
    requestAnimationFrame(drawFrame);
  }

  function flashJudge(label, color) {
    const judge = $('#judge-text');
    judge.textContent = label;
    judge.style.color = color;
    judge.classList.add('show');
    $('#hit-flash').classList.add('active');
    window.clearTimeout(state.judgeTimer);
    state.judgeTimer = window.setTimeout(() => {
      judge.classList.remove('show');
      $('#hit-flash').classList.remove('active');
    }, 190);
  }

  function registerHit(note, delta) {
    note.judged = true;
    const absolute = Math.abs(delta);
    const grade = absolute < 0.065 ? 'PERFECT' : absolute < 0.13 ? 'GREAT' : 'GOOD';
    const points = grade === 'PERFECT' ? 1000 : grade === 'GREAT' ? 700 : 400;
    state.combo += 1;
    state.score += points + Math.min(state.combo, 100) * 5;
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem('neon-best-score', String(state.best));
    }
    updateHud();
    flashJudge(grade, judgeColor(grade));
  }

  function registerMiss() {
    state.combo = 0;
    updateHud();
    flashJudge('MISS', judgeColor('MISS'));
  }

  function hitLane(lane) {
    flashKeys([laneKeyElements[lane]], `lane-${lane}`);
    if (!state.running) return;
    const now = audio.currentTime;
    let candidate = null;
    let closest = Infinity;
    for (const note of state.notes) {
      if (note.judged || note.missed || note.lane !== lane) continue;
      const delta = now - note.time;
      if (Math.abs(delta) <= 0.2 && Math.abs(delta) < closest) {
        closest = Math.abs(delta);
        candidate = { note, delta };
      }
    }
    if (candidate) registerHit(candidate.note, candidate.delta);
    else {
      const nearTime = state.notes.some((note) => !note.judged && !note.missed && Math.abs(note.time - now) < 0.25);
      if (!nearTime) return;
      registerMiss();
    }
  }

  function laneFromPointer(event) {
    const rect = playfield.getBoundingClientRect();
    const layout = getLayout();
    const x = event.clientX - rect.left;
    const laneLeft = layout.centerX - layout.stageWidth / 2;
    return Math.max(0, Math.min(layout.laneCount - 1, Math.floor((x - laneLeft) / layout.laneWidth)));
  }

  playfield.addEventListener('pointerdown', (event) => {
    if (event.target.closest('button')) return;
    event.preventDefault();
    const lane = laneFromPointer(event);
    state.pointerDown.set(event.pointerId, { lane, startedAt: performance.now() });
    playfield.setPointerCapture(event.pointerId);
    hitLane(lane);
  });

  playfield.addEventListener('pointerup', (event) => {
    const press = state.pointerDown.get(event.pointerId);
    if (!press) return;
    const held = performance.now() - press.startedAt;
    if (held > 320) {
      const sustain = state.notes.find((note) => note.long && note.lane === press.lane && note.judged && !note.missed && Math.abs(note.time - audio.currentTime) < 0.45);
      if (sustain) {
        state.score += 350;
        updateHud();
        flashJudge('HOLD +350', judgeColor('HOLD'));
      }
    }
    state.pointerDown.delete(event.pointerId);
  });

  playfield.addEventListener('pointercancel', (event) => state.pointerDown.delete(event.pointerId));

  const keyLanes = { d: 0, f: 1, j: 2, k: 3 };
  window.addEventListener('keydown', (event) => {
    if (event.repeat || event.target.matches('input,button,textarea,select')) return;
    const lane = keyLanes[event.key.toLowerCase()];
    if (lane !== undefined) {
      event.preventDefault();
      hitLane(lane);
    } else if (event.code === 'Space' && state.audioBuffer) {
      event.preventDefault();
      flashKeys(spaceKeyElements, 'space');
      if (audio.paused) startPlayback();
      else pausePlayback();
    }
  });

  window.addEventListener('resize', () => {
    const rect = playfield.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  });

  requestAnimationFrame(drawFrame);
})();
