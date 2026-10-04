'use client'

// Web Audio API Synthesizer for Authentic Hospital & Cyber Patient Monitor Sound FX
// DRAMATICALLY distinct diagnosis-specific sound signatures for real-time monitoring.
// Each diagnosis has unique: pitch, waveform, rhythm, duration, and envelope.

export interface PulseParams {
  hr?: number
  spo2?: number
  temp?: number
  rr?: number
  status?: 'normal' | 'attention' | 'warning' | 'critical' | string
  riskScore?: number
}

export type DiagnosisType = 
  | 'normal' 
  | 'tachycardia' 
  | 'bradycardia' 
  | 'hypoxia' 
  | 'pyrexia' 
  | 'arrhythmia' 
  | 'critical'

class PatientMonitorAudio {
  private ctx: AudioContext | null = null
  public enabled: boolean = false

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  public toggleSound(force?: boolean): boolean {
    this.enabled = force !== undefined ? force : !this.enabled
    if (this.enabled) {
      this.initCtx()
      this.playUiClick()
    }
    return this.enabled
  }

  /**
   * Determine Diagnosis Type from vitals
   */
  public determineDiagnosis(p: PulseParams): DiagnosisType {
    const hr = p.hr ?? 72
    const spo2 = p.spo2 ?? 98
    const temp = p.temp ?? 36.8
    const status = p.status ?? 'normal'
    const riskScore = p.riskScore ?? 15

    if (status === 'critical' || riskScore > 65 || (spo2 < 88 && hr > 120)) return 'critical'
    if (spo2 < 92) return 'hypoxia'
    if (hr > 115) return 'tachycardia'
    if (hr < 55) return 'bradycardia'
    if (temp >= 38.0) return 'pyrexia'
    if (riskScore > 40) return 'arrhythmia'
    return 'normal'
  }

  /**
   * MAIN: Diagnosis-Specific Heartbeat & Pulse Synthesizer
   * Each diagnosis has a DRAMATICALLY different sound signature:
   * 
   * - NORMAL:       Clean single "beep" at ~960Hz (classic hospital SpO2 pulse)
   * - TACHYCARDIA:  Rapid double-tap "lub-DUB" at high pitch (1200Hz + 950Hz)
   * - BRADYCARDIA:  Deep, long, resonant low "BONG" at ~280Hz with sub-bass
   * - HYPOXIA:      Descending pitch sweep/glissando (1000Hz → 400Hz) — THE desaturation sound
   * - PYREXIA:      Tremolo warble with vibrato (shimmering, unstable tone)
   * - ARRHYTHMIA:   Dissonant dual-tone clash (two close frequencies beating)
   * - CRITICAL:     Triple-burst alarm beep + dissonance (URGENT)
   */
  public playHeartbeatBeep(params?: number | PulseParams) {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    let p: PulseParams = {}
    if (typeof params === 'number') {
      p = { hr: params, spo2: 98 }
    } else if (params) {
      p = params
    }

    const diag = this.determineDiagnosis(p)

    try {
      const now = this.ctx.currentTime

      switch (diag) {

        // ═══════════════════════════════════════════════════════════════
        // TACHYCARDIA — Rapid Double-Tap "Lub-DUB" (high pitch, fast)
        // Two short beeps in quick succession at different pitches
        // ═══════════════════════════════════════════════════════════════
        case 'tachycardia': {
          // First beat "Lub" — high pitched short
          const osc1 = this.ctx.createOscillator()
          const gain1 = this.ctx.createGain()
          osc1.type = 'sine'
          osc1.frequency.setValueAtTime(1200, now)

          gain1.gain.setValueAtTime(0, now)
          gain1.gain.linearRampToValueAtTime(0.35, now + 0.005)
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.06)

          osc1.connect(gain1)
          gain1.connect(this.ctx.destination)
          osc1.start(now)
          osc1.stop(now + 0.07)

          // Second beat "DUB" — lower pitch, 70ms later
          const osc2 = this.ctx.createOscillator()
          const gain2 = this.ctx.createGain()
          const t2 = now + 0.07
          osc2.type = 'sine'
          osc2.frequency.setValueAtTime(950, t2)

          gain2.gain.setValueAtTime(0, t2)
          gain2.gain.linearRampToValueAtTime(0.28, t2 + 0.005)
          gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.055)

          osc2.connect(gain2)
          gain2.connect(this.ctx.destination)
          osc2.start(t2)
          osc2.stop(t2 + 0.06)
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // BRADYCARDIA — Deep resonant low "BONG" with sub-bass octave
        // Very different from normal — low frequency, long sustain
        // ═══════════════════════════════════════════════════════════════
        case 'bradycardia': {
          const osc = this.ctx.createOscillator()
          const sub = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          // Main tone: LOW pitch
          osc.type = 'sine'
          osc.frequency.setValueAtTime(280, now)
          
          // Sub-bass: even lower octave
          sub.type = 'sine'
          sub.frequency.setValueAtTime(140, now)

          // Long, warm envelope
          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.38, now + 0.01)
          gain.gain.setValueAtTime(0.30, now + 0.05)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

          osc.connect(gain)
          sub.connect(gain)
          gain.connect(this.ctx.destination)

          osc.start(now)
          sub.start(now)
          osc.stop(now + 0.26)
          sub.stop(now + 0.26)
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // HYPOXIA — Descending pitch glissando sweep (1000Hz → 400Hz)
        // THE hallmark desaturation sound — pitch drops as SpO2 drops
        // ═══════════════════════════════════════════════════════════════
        case 'hypoxia': {
          const spo2 = p.spo2 ?? 90
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          osc.type = 'sine'
          // Start pitch mapped to SpO2 (lower SpO2 = lower start)
          const startPitch = 600 + (spo2 - 70) * 14
          const endPitch = startPitch * 0.42

          osc.frequency.setValueAtTime(startPitch, now)
          osc.frequency.exponentialRampToValueAtTime(endPitch, now + 0.18)

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.35, now + 0.008)
          gain.gain.setValueAtTime(0.28, now + 0.10)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20)

          osc.connect(gain)
          gain.connect(this.ctx.destination)
          osc.start(now)
          osc.stop(now + 0.22)
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // PYREXIA — Shimmering tremolo/vibrato warble (fever sound)
        // Triangle wave with rapid LFO vibrato = unstable, shimmery
        // ═══════════════════════════════════════════════════════════════
        case 'pyrexia': {
          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()
          const lfo = this.ctx.createOscillator()
          const lfoGain = this.ctx.createGain()

          osc.type = 'triangle'
          osc.frequency.setValueAtTime(780, now)

          // 14Hz tremolo vibrato — creates distinct "warble" effect
          lfo.type = 'sine'
          lfo.frequency.setValueAtTime(14, now)
          lfoGain.gain.setValueAtTime(80, now) // Wide pitch modulation
          lfo.connect(lfoGain)
          lfoGain.connect(osc.frequency)

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.30, now + 0.008)
          gain.gain.setValueAtTime(0.22, now + 0.08)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)

          osc.connect(gain)
          gain.connect(this.ctx.destination)

          lfo.start(now)
          osc.start(now)
          lfo.stop(now + 0.19)
          osc.stop(now + 0.19)
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // ARRHYTHMIA — Dissonant dual-tone beating (minor 2nd clash)
        // Two close frequencies create audible "beating" interference
        // ═══════════════════════════════════════════════════════════════
        case 'arrhythmia': {
          const osc1 = this.ctx.createOscillator()
          const osc2 = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          osc1.type = 'triangle'
          osc1.frequency.setValueAtTime(880, now)
          // Minor 2nd above = dissonant beating
          osc2.type = 'sawtooth'
          osc2.frequency.setValueAtTime(932, now) // ~minor 2nd

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.25, now + 0.005)
          gain.gain.setValueAtTime(0.20, now + 0.06)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

          osc1.connect(gain)
          osc2.connect(gain)
          gain.connect(this.ctx.destination)

          osc1.start(now)
          osc2.start(now)
          osc1.stop(now + 0.16)
          osc2.stop(now + 0.16)
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL — Urgent triple-burst alarm (3 rapid beeps + dissonance)
        // Most alarming sound: square wave, high gain, 3 rapid pulses
        // ═══════════════════════════════════════════════════════════════
        case 'critical': {
          const bursts = [0, 0.08, 0.16]
          bursts.forEach((delay) => {
            if (!this.ctx) return
            const osc = this.ctx.createOscillator()
            const osc2 = this.ctx.createOscillator()
            const gain = this.ctx.createGain()
            const t = now + delay

            osc.type = 'square'
            osc.frequency.setValueAtTime(1000, t)
            // Dissonant overtone
            osc2.type = 'sine'
            osc2.frequency.setValueAtTime(1060, t)

            gain.gain.setValueAtTime(0, t)
            gain.gain.linearRampToValueAtTime(0.30, t + 0.004)
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055)

            osc.connect(gain)
            osc2.connect(gain)
            gain.connect(this.ctx.destination)

            osc.start(t)
            osc2.start(t)
            osc.stop(t + 0.06)
            osc2.stop(t + 0.06)
          })
          break
        }

        // ═══════════════════════════════════════════════════════════════
        // NORMAL — Clean hospital SpO2 sine pulse (classic "beep")
        // Single warm sine tone, SpO2-pitched (higher SpO2 = higher pitch)
        // ═══════════════════════════════════════════════════════════════
        default: {
          const spo2 = p.spo2 ?? 98
          const clampedSpo2 = Math.max(70, Math.min(100, spo2))
          // SpO2 pitch scale: 100% → 960Hz, 90% → 780Hz, 80% → 600Hz
          const pitch = 420 + (clampedSpo2 - 70) * 18

          const osc = this.ctx.createOscillator()
          const gain = this.ctx.createGain()

          osc.type = 'sine'
          osc.frequency.setValueAtTime(pitch, now)

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.30, now + 0.006)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12)

          osc.connect(gain)
          gain.connect(this.ctx.destination)
          osc.start(now)
          osc.stop(now + 0.13)
          break
        }
      }
    } catch {
      // Audio context error suppression
    }
  }

  /**
   * 2. Urgent Medical Alert Alarms (IEC 60601-1-8 Standard Chimes)
   */
  public playAlertAlarm(severity: 'critical' | 'warning' | 'info' = 'warning') {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const isCritical = severity === 'critical'
      const isInfo = severity === 'info'

      const tones = isCritical 
        ? [523.25, 659.25, 784.00, 1046.50, 1318.51]
        : isInfo
        ? [587.33, 880.00]
        : [440.00, 554.37, 659.25]

      const noteDuration = isCritical ? 0.09 : 0.12
      const gap = isCritical ? 0.10 : 0.14

      tones.forEach((freq, idx) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        osc.type = isCritical ? 'square' : 'sine'
        const startTime = now + idx * gap
        osc.frequency.setValueAtTime(freq, startTime)

        gain.gain.setValueAtTime(0, startTime)
        gain.gain.linearRampToValueAtTime(isCritical ? 0.20 : 0.12, startTime + 0.005)
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteDuration)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start(startTime)
        osc.stop(startTime + noteDuration + 0.01)
      })
    } catch {
      // Audio context catch
    }
  }

  /**
   * 3. Distinct Patient Selection Sound (Based on Patient Diagnosis)
   */
  public playPatientSelectSound(patient?: PulseParams) {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const diag = patient ? this.determineDiagnosis(patient) : 'normal'

      let notes = [523.25, 783.99] // C5 -> G5 (Normal — ascending perfect 5th)
      let waveType: OscillatorType = 'sine'

      if (diag === 'critical' || diag === 'hypoxia') {
        notes = [349.23, 493.88] // F4 -> B4 (Tritone — ominous)
        waveType = 'triangle'
      } else if (diag === 'tachycardia' || diag === 'arrhythmia') {
        notes = [440.00, 554.37, 659.25] // A4 -> C#5 -> E5 (Rapid triad)
        waveType = 'sine'
      } else if (diag === 'bradycardia') {
        notes = [261.63, 392.00] // C4 -> G4 (Low register)
        waveType = 'sine'
      } else if (diag === 'pyrexia') {
        notes = [587.33, 739.99] // D5 -> F#5 (Warm major 3rd)
        waveType = 'triangle'
      }

      notes.forEach((freq, idx) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        const start = now + idx * 0.07
        osc.type = waveType
        osc.frequency.setValueAtTime(freq, start)

        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.12, start + 0.005)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start(start)
        osc.stop(start + 0.13)
      })
    } catch {
      // Audio context catch
    }
  }

  /**
   * 4. Soft Cyber UI Click
   */
  public playUiClick() {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      const now = this.ctx.currentTime
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1400, now)
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.03)

      gain.gain.setValueAtTime(0.08, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.035)
    } catch {
      // Audio context catch
    }
  }

  /**
   * 5. Alert Acknowledge Chime
   */
  public playAckSound() {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const notes = [587.33, 880]

      notes.forEach((freq, idx) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        osc.type = 'sine'
        const start = now + idx * 0.08
        osc.frequency.setValueAtTime(freq, start)

        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.12, start + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start(start)
        osc.stop(start + 0.14)
      })
    } catch {
      // Audio context catch
    }
  }

  /**
   * 6. Diagnosis Sound Audition Demo — LOUDER versions for testing
   */
  public playTestSound(type: DiagnosisType) {
    if (!this.enabled) this.toggleSound(true)
    
    switch (type) {
      case 'normal':
        this.playHeartbeatBeep({ hr: 72, spo2: 99, temp: 36.7, status: 'normal', riskScore: 10 })
        break
      case 'tachycardia':
        this.playHeartbeatBeep({ hr: 135, spo2: 97, temp: 36.8, status: 'warning', riskScore: 35 })
        break
      case 'bradycardia':
        this.playHeartbeatBeep({ hr: 48, spo2: 96, temp: 36.5, status: 'warning', riskScore: 30 })
        break
      case 'hypoxia':
        this.playHeartbeatBeep({ hr: 85, spo2: 84, temp: 36.8, status: 'attention', riskScore: 55 })
        break
      case 'pyrexia':
        this.playHeartbeatBeep({ hr: 98, spo2: 96, temp: 38.6, status: 'attention', riskScore: 38 })
        break
      case 'critical':
      case 'arrhythmia':
        this.playHeartbeatBeep({ hr: 155, spo2: 80, temp: 37.0, status: 'critical', riskScore: 85 })
        this.playAlertAlarm('critical')
        break
    }
  }

  /**
   * 7. Futuristic AI Diagnostic Laser Scan Audio FX
   */
  public playScanSound() {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(320, now)
      osc.frequency.exponentialRampToValueAtTime(1600, now + 0.35)
      osc.frequency.exponentialRampToValueAtTime(500, now + 0.65)

      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.12, now + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65)

      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(now)
      osc.stop(now + 0.7)
    } catch {
      // Audio context catch
    }
  }
}

export const monitorAudio = new PatientMonitorAudio()
