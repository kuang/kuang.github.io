/* ------------------------------------------------------------------
   COIN PUSHER — audio engine
   Everything here is synthesized with the Web Audio API at runtime:
   coin clinks, the cash register, the pusher motor, and a looping
   chiptune soundtrack. No audio files.
   ------------------------------------------------------------------ */
window.ArcadeAudio = (function () {
  'use strict';

  var ctx = null;
  var master, comp, sfxBus, musicBus, musicDelay;
  var noiseBuf = null;
  var pulse25 = null, pulse12 = null;
  var leadLfo = null;
  var settings = { music: true, sfx: true, volume: 0.7 };
  var musicTimer = null, stepIndex = 0, nextStepTime = 0, musicRunning = false;
  var motor = null;
  var recentClinks = [];

  /* ------------------------------ setup ------------------------------ */
  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = settings.volume;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;

    sfxBus = ctx.createGain();
    sfxBus.gain.value = settings.sfx ? 1 : 0;
    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? 1 : 0;

    // a little echo on the music bus for that cavernous arcade feel
    musicDelay = ctx.createDelay(1.0);
    musicDelay.delayTime.value = 0.317;
    var fb = ctx.createGain();
    fb.gain.value = 0.22;
    var wet = ctx.createGain();
    wet.gain.value = 0.35;
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    musicDelay.connect(tone);
    tone.connect(fb);
    fb.connect(musicDelay);
    tone.connect(wet);
    wet.connect(musicBus);

    sfxBus.connect(comp);
    musicBus.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    noiseBuf = makeNoise();
    pulse25 = makePulse(0.25);
    pulse12 = makePulse(0.125);

    leadLfo = ctx.createOscillator();
    leadLfo.type = 'sine';
    leadLfo.frequency.value = 5.6;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 7; // cents
    leadLfo.connect(lfoGain);
    leadLfo.start();
    leadLfo._out = lfoGain;

    document.addEventListener('visibilitychange', function () {
      if (!ctx) return;
      if (document.hidden) {
        ctx.suspend();
      } else {
        ctx.resume();
        // re-anchor the sequencer so it doesn't try to catch up
        nextStepTime = ctx.currentTime + 0.05;
      }
    });
    return true;
  }

  function unlock() {
    if (!ensure()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  function makeNoise() {
    var len = ctx.sampleRate * 1.5;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // pulse wave with an arbitrary duty cycle, via numeric Fourier series
  function makePulse(duty) {
    var N = 48, S = 1024;
    var real = new Float32Array(N), imag = new Float32Array(N);
    for (var n = 1; n < N; n++) {
      var re = 0, im = 0;
      for (var s = 0; s < S; s++) {
        var v = (s / S) < duty ? 1 : -1;
        var ang = 2 * Math.PI * n * s / S;
        re += v * Math.cos(ang);
        im += v * Math.sin(ang);
      }
      real[n] = re / S;
      imag[n] = im / S;
    }
    return ctx.createPeriodicWave(real, imag);
  }

  /* ------------------------------ primitives ------------------------------ */
  function osc(opts) {
    var o = ctx.createOscillator();
    if (opts.wave) o.setPeriodicWave(opts.wave);
    else o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.freq, opts.t);
    if (opts.slideTo) {
      o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slideTo), opts.t + (opts.slideTime || opts.dur));
    }
    if (opts.detune) o.detune.setValueAtTime(opts.detune, opts.t);
    if (opts.lfo) opts.lfo.connect(o.detune);
    var g = ctx.createGain();
    var a = opts.attack || 0.003;
    var peak = opts.gain || 0.2;
    g.gain.setValueAtTime(0.0001, opts.t);
    g.gain.linearRampToValueAtTime(peak, opts.t + a);
    if (opts.sustain != null) {
      // ADSR-ish: decay to sustain, hold, release
      var dec = opts.decay || 0.05;
      var rel = opts.release || 0.03;
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * opts.sustain), opts.t + a + dec);
      g.gain.setValueAtTime(Math.max(0.0001, peak * opts.sustain), opts.t + opts.dur);
      g.gain.exponentialRampToValueAtTime(0.0001, opts.t + opts.dur + rel);
      o.start(opts.t);
      o.stop(opts.t + opts.dur + rel + 0.02);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, opts.t + a + opts.dur);
      o.start(opts.t);
      o.stop(opts.t + a + opts.dur + 0.02);
    }
    o.connect(g);
    g.connect(opts.dest || sfxBus);
    return o;
  }

  function noise(opts) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = opts.rate || 1;
    var f = ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.freq || 2000, opts.t);
    if (opts.freqTo) f.frequency.exponentialRampToValueAtTime(opts.freqTo, opts.t + opts.dur);
    f.Q.value = opts.q || 1;
    var g = ctx.createGain();
    var a = opts.attack || 0.002;
    g.gain.setValueAtTime(0.0001, opts.t);
    g.gain.linearRampToValueAtTime(opts.gain || 0.2, opts.t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, opts.t + a + opts.dur);
    src.connect(f);
    f.connect(g);
    g.connect(opts.dest || sfxBus);
    src.start(opts.t, Math.random() * 1.0);
    src.stop(opts.t + a + opts.dur + 0.02);
  }

  // Keep a cascade of 40 coins from turning into white noise:
  // many hits inside a short window get progressively quieter.
  function crowd(t) {
    var cutoff = t - 0.12;
    var keep = [];
    for (var i = 0; i < recentClinks.length; i++) if (recentClinks[i] > cutoff) keep.push(recentClinks[i]);
    recentClinks = keep;
    recentClinks.push(t);
    var n = recentClinks.length;
    if (n > 18) return 0;
    if (n > 8) return 0.3;
    if (n > 4) return 0.6;
    return 1;
  }

  // metallic "ting": a few inharmonic partials that ring down fast
  function metal(t, base, vol, decay, partials) {
    partials = partials || [[1, 1], [1.52, 0.55], [2.08, 0.35], [2.9, 0.22], [3.7, 0.12]];
    for (var i = 0; i < partials.length; i++) {
      osc({
        type: 'sine',
        freq: base * partials[i][0] * (1 + (Math.random() - 0.5) * 0.01),
        t: t,
        dur: decay * (1 - i * 0.12),
        gain: vol * partials[i][1],
        attack: 0.001
      });
    }
    noise({ t: t, dur: 0.012, filter: 'highpass', freq: 5000, gain: vol * 0.7 });
  }

  /* ------------------------------ sound effects ------------------------------ */
  // a quarter landing on the metal shelf
  function coinTink(when, vol) {
    if (!ctx) return;
    var t = Math.max(now(), when || now());
    var k = crowd(t);
    if (!k) return;
    var pitch = 0.9 + Math.random() * 0.2;
    metal(t, 2500 * pitch, 0.22 * (vol || 1) * k, 0.16);
  }

  // a quarter tipping off the shelf onto the pile
  function coinClink(when, vol) {
    if (!ctx) return;
    var t = Math.max(now(), when || now());
    var k = crowd(t);
    if (!k) return;
    var pitch = 0.85 + Math.random() * 0.3;
    metal(t, 1900 * pitch, 0.14 * (vol || 1) * k, 0.11);
  }

  // a quarter dropping over the ledge into the payout tray: bounce, bounce, settle
  function coinPayout(when, vol) {
    if (!ctx) return;
    var t = Math.max(now(), when || now());
    var k = crowd(t);
    if (!k) return;
    vol = (vol || 1) * k;
    var pitch = 0.9 + Math.random() * 0.2;
    metal(t, 2100 * pitch, 0.3 * vol, 0.3);
    var t2 = t + 0.06 + Math.random() * 0.04;
    metal(t2, 2300 * pitch, 0.18 * vol, 0.18, [[1, 1], [1.4, 0.4], [2.2, 0.25]]);
    var t3 = t2 + 0.05 + Math.random() * 0.04;
    metal(t3, 2000 * pitch, 0.09 * vol, 0.12, [[1, 1], [1.6, 0.4]]);
    // the dull thud of it hitting the tray floor
    noise({ t: t, dur: 0.07, filter: 'lowpass', freq: 500, gain: 0.25 * vol });
  }

  // a quarter sliding out the side into the house's pocket
  function coinLost(when) {
    if (!ctx) return;
    var t = Math.max(now(), when || now());
    noise({ t: t, dur: 0.14, filter: 'lowpass', freq: 700, freqTo: 200, gain: 0.28 });
    osc({ type: 'sine', freq: 180, slideTo: 60, t: t, dur: 0.16, gain: 0.25 });
    metal(t + 0.02, 1500, 0.05, 0.08, [[1, 1], [1.7, 0.4]]);
  }

  // cash register: "ka-CHING" plus a stack of quarters plopping onto the counter
  function chaching() {
    if (!ctx) return;
    var t = now() + 0.01;
    noise({ t: t, dur: 0.05, filter: 'bandpass', freq: 3000, q: 0.6, gain: 0.35 });
    noise({ t: t + 0.07, dur: 0.04, filter: 'bandpass', freq: 1800, q: 0.8, gain: 0.25 });
    var bells = [2093, 2637, 3136, 4186];
    for (var i = 0; i < bells.length; i++) {
      osc({ type: 'sine', freq: bells[i] * (1 + (Math.random() - 0.5) * 0.004), t: t + 0.1, dur: 0.9 - i * 0.12, gain: 0.16 / (i + 1), attack: 0.002 });
    }
    osc({ type: 'triangle', freq: 1046, t: t + 0.1, dur: 0.5, gain: 0.08 });
    for (var j = 0; j < 7; j++) {
      metal(t + 0.25 + j * 0.045 + Math.random() * 0.01, 2300 + j * 120, 0.12, 0.12);
    }
  }

  // nope: no coins to drop
  function buzz() {
    if (!ctx) return;
    var t = now() + 0.005;
    osc({ type: 'square', freq: 110, t: t, dur: 0.16, gain: 0.08, attack: 0.005 });
    osc({ type: 'square', freq: 116, t: t, dur: 0.16, gain: 0.05, attack: 0.005 });
  }

  // UI tick
  function click() {
    if (!ctx) return;
    var t = now() + 0.002;
    noise({ t: t, dur: 0.012, filter: 'highpass', freq: 3000, gain: 0.15 });
    osc({ type: 'sine', freq: 1400, t: t, dur: 0.03, gain: 0.08 });
  }

  // little victory arpeggio for a big cascade
  function fanfare(size) {
    if (!ctx) return;
    var t = now() + 0.01;
    var notes = size >= 3 ? [60, 64, 67, 72, 76, 79, 84, 88] : size >= 2 ? [60, 64, 67, 72, 76, 79] : [67, 72, 76, 79];
    for (var i = 0; i < notes.length; i++) {
      var f = midiToHz(notes[i]);
      osc({ wave: pulse25, freq: f, t: t + i * 0.055, dur: 0.16, gain: 0.07, attack: 0.002 });
      osc({ type: 'sine', freq: f * 2, t: t + i * 0.055, dur: 0.22, gain: 0.03, attack: 0.002 });
    }
    var tail = t + notes.length * 0.055;
    for (var k = 0; k < 10; k++) {
      osc({ type: 'sine', freq: 3000 + Math.random() * 4000, t: tail + k * 0.03, dur: 0.2, gain: 0.03, attack: 0.001 });
    }
  }

  // the pusher reaching the end of its stroke: a soft mechanical clunk
  function motorClunk(soft) {
    if (!ctx) return;
    var t = now() + 0.005;
    noise({ t: t, dur: 0.09, filter: 'lowpass', freq: 420, gain: soft ? 0.12 : 0.2 });
    osc({ type: 'sine', freq: 90, slideTo: 50, t: t, dur: 0.1, gain: soft ? 0.08 : 0.14 });
  }

  function motorStart() {
    if (!ctx || motor) return;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 44;
    var o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 88.5;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 140;
    f.Q.value = 2;
    var g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.linearRampToValueAtTime(0.045, now() + 1.2);
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.36;
    var lfoG = ctx.createGain();
    lfoG.gain.value = 0.012;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    o.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    o.start();
    o2.start();
    lfo.start();
    motor = { o: o, o2: o2, lfo: lfo, g: g };
  }

  function motorStop() {
    if (!motor) return;
    var t = now();
    motor.g.gain.cancelScheduledValues(t);
    motor.g.gain.setValueAtTime(motor.g.gain.value, t);
    motor.g.gain.linearRampToValueAtTime(0.0001, t + 0.4);
    var m = motor;
    motor = null;
    setTimeout(function () { try { m.o.stop(); m.o2.stop(); m.lfo.stop(); } catch (e) { /* already stopped */ } }, 500);
  }

  /* ------------------------------ music ------------------------------ */
  var BPM = 142;
  var STEP = 60 / BPM / 4;         // one 16th note
  var STEPS_PER_BAR = 16;

  // I – V – vi – IV, twice around, with a turnaround on the last bar.
  var LEAD = [
    'E5 . . G5 . . C6 . . . G5 . E5 . G5 .',
    'D5 . . G5 . . B5 . . . G5 . D5 . G5 .',
    'C5 . . E5 . . A5 . . . E5 . C5 . E5 .',
    'A5 . . C6 . . F6 . . . E6 . D6 . B5 .',
    'C6 . . . G5 . E5 . C6 . . . G5 . E5 .',
    'B5 . . . D6 . G5 . B5 . . . D6 . G6 .',
    'A5 . . C6 . . F6 . . . E6 . C6 . A5 .',
    'G5 . B5 . D6 . G6 . . . F6 . D6 . B5 .'
  ].join(' ');

  var BASS_C = 'C3 . C3 . G3 . C3 . C4 . C3 . G3 . C3 .';
  var BASS_G = 'G2 . G2 . D3 . G2 . G3 . G2 . D3 . G2 .';
  var BASS_A = 'A2 . A2 . E3 . A2 . A3 . A2 . E3 . A2 .';
  var BASS_F = 'F2 . F2 . C3 . F2 . F3 . F2 . C3 . F2 .';
  var BASS = [BASS_C, BASS_G, BASS_A, BASS_F, BASS_C, BASS_G, BASS_F, BASS_G].join(' ');

  var ARP_C = 'C4 . E4 . G4 . C5 . E5 . C5 . G4 . E4 .';
  var ARP_G = 'G3 . B3 . D4 . G4 . B4 . G4 . D4 . B3 .';
  var ARP_A = 'A3 . C4 . E4 . A4 . C5 . A4 . E4 . C4 .';
  var ARP_F = 'F3 . A3 . C4 . F4 . A4 . F4 . C4 . A3 .';
  var ARP = [ARP_C, ARP_G, ARP_A, ARP_F, ARP_C, ARP_G, ARP_F, ARP_G].join(' ');

  var KICK_BAR = 'x . . . . . . x . . x . . . . .';
  var KICK_FILL = 'x . . . . . . x . . x . x . . .';
  var SNARE_BAR = '. . . . x . . . . . . . x . . .';
  var SNARE_FILL = '. . . . x . . . . . . . x . x x';
  var HAT_BAR = 'c . c . c . c . c . c . c . c o';
  var KICK = [KICK_BAR, KICK_BAR, KICK_BAR, KICK_BAR, KICK_BAR, KICK_BAR, KICK_BAR, KICK_FILL].join(' ');
  var SNARE = [SNARE_BAR, SNARE_BAR, SNARE_BAR, SNARE_BAR, SNARE_BAR, SNARE_BAR, SNARE_BAR, SNARE_FILL].join(' ');
  var HAT = [HAT_BAR, HAT_BAR, HAT_BAR, HAT_BAR, HAT_BAR, HAT_BAR, HAT_BAR, HAT_BAR].join(' ');

  var NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function parseMelody(str) {
    var tokens = str.trim().split(/\s+/);
    var events = new Array(tokens.length);
    var last = null;
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      events[i] = null;
      if (tok === '.') {
        if (last) last.len++;
        continue;
      }
      if (tok === '-') { last = null; continue; }
      var m = /^([A-G])(#|b)?(\d)$/.exec(tok);
      if (!m) { last = null; continue; }
      var midi = 12 * (parseInt(m[3], 10) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
      last = { midi: midi, len: 1 };
      events[i] = last;
    }
    return events;
  }

  function parseDrums(str) { return str.trim().split(/\s+/); }

  var SONG = null;
  function buildSong() {
    SONG = {
      lead: parseMelody(LEAD),
      bass: parseMelody(BASS),
      arp: parseMelody(ARP),
      kick: parseDrums(KICK),
      snare: parseDrums(SNARE),
      hat: parseDrums(HAT)
    };
    SONG.length = SONG.lead.length;
  }

  function playLead(t, midi, len) {
    var dur = len * STEP * 0.92;
    var f = midiToHz(midi);
    osc({ type: 'square', freq: f, t: t, dur: dur, gain: 0.075, attack: 0.004, sustain: 0.6, decay: 0.09, release: 0.04, dest: musicBus, lfo: leadLfo._out });
    osc({ wave: pulse25, freq: f, t: t, dur: dur, gain: 0.04, attune: 0, detune: -5, attack: 0.004, sustain: 0.6, decay: 0.09, release: 0.04, dest: musicDelay, lfo: leadLfo._out });
  }

  function playArp(t, midi, len) {
    var dur = Math.min(len * STEP * 0.55, 0.12);
    osc({ wave: pulse12, freq: midiToHz(midi), t: t, dur: dur, gain: 0.035, attack: 0.002, sustain: 0.5, decay: 0.04, release: 0.02, dest: musicBus });
  }

  function playBass(t, midi, len) {
    var dur = len * STEP * 0.8;
    var f = midiToHz(midi);
    osc({ type: 'triangle', freq: f, t: t, dur: dur, gain: 0.2, attack: 0.004, sustain: 0.7, decay: 0.06, release: 0.03, dest: musicBus });
    osc({ type: 'square', freq: f, t: t, dur: dur, gain: 0.03, attack: 0.004, sustain: 0.5, decay: 0.05, release: 0.03, dest: musicBus });
  }

  function playKick(t) {
    osc({ type: 'sine', freq: 170, slideTo: 42, slideTime: 0.11, t: t, dur: 0.2, gain: 0.5, attack: 0.002, dest: musicBus });
    noise({ t: t, dur: 0.012, filter: 'highpass', freq: 2500, gain: 0.12, dest: musicBus });
  }

  function playSnare(t, accent) {
    noise({ t: t, dur: 0.11, filter: 'bandpass', freq: 1900, q: 0.8, gain: accent ? 0.3 : 0.24, dest: musicBus });
    noise({ t: t, dur: 0.05, filter: 'highpass', freq: 5000, gain: 0.12, dest: musicBus });
    osc({ type: 'sine', freq: 200, slideTo: 120, slideTime: 0.05, t: t, dur: 0.07, gain: 0.18, attack: 0.001, dest: musicBus });
  }

  function playHat(t, open) {
    noise({ t: t, dur: open ? 0.14 : 0.03, filter: 'highpass', freq: 8000, gain: open ? 0.07 : 0.05, dest: musicBus });
  }

  function scheduleStep(step, t) {
    var i = step % SONG.length;
    var e;
    if ((e = SONG.lead[i])) playLead(t, e.midi, e.len);
    if ((e = SONG.bass[i])) playBass(t, e.midi, e.len);
    if ((e = SONG.arp[i])) playArp(t, e.midi, e.len);
    if (SONG.kick[i] === 'x') playKick(t);
    if (SONG.snare[i] === 'x') playSnare(t, (i % STEPS_PER_BAR) === 4 || (i % STEPS_PER_BAR) === 12);
    if (SONG.hat[i] === 'c') playHat(t, false);
    else if (SONG.hat[i] === 'o') playHat(t, true);
  }

  function scheduler() {
    if (!musicRunning) return;
    var lookahead = 0.16;
    while (nextStepTime < ctx.currentTime + lookahead) {
      if (nextStepTime >= ctx.currentTime - 0.05) scheduleStep(stepIndex, nextStepTime);
      nextStepTime += STEP;
      stepIndex++;
    }
  }

  function startMusic() {
    if (!ctx || musicRunning) return;
    if (!SONG) buildSong();
    musicRunning = true;
    stepIndex = 0;
    nextStepTime = ctx.currentTime + 0.1;
    musicTimer = setInterval(scheduler, 30);
  }

  function stopMusic() {
    musicRunning = false;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  /* ------------------------------ settings ------------------------------ */
  function setMusic(on) {
    settings.music = !!on;
    if (musicBus) musicBus.gain.setTargetAtTime(on ? 1 : 0, now(), 0.05);
    if (on && ctx && !musicRunning) startMusic();
  }
  function setSfx(on) {
    settings.sfx = !!on;
    if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, now(), 0.05);
  }
  function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.setTargetAtTime(settings.volume * settings.volume, now(), 0.05);
  }

  return {
    unlock: unlock,
    ready: function () { return !!ctx; },
    now: now,
    coinTink: coinTink,
    coinClink: coinClink,
    coinPayout: coinPayout,
    coinLost: coinLost,
    chaching: chaching,
    buzz: buzz,
    click: click,
    fanfare: fanfare,
    motorClunk: motorClunk,
    motorStart: motorStart,
    motorStop: motorStop,
    startMusic: startMusic,
    stopMusic: stopMusic,
    setMusic: setMusic,
    setSfx: setSfx,
    setVolume: setVolume,
    settings: settings
  };
})();
