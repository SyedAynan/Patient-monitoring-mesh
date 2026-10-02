'use client'

// Web Audio API Synthesizer for Authentic Hospital & Cyber Patient Monitor Sound FX

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

  // 1. Hospital Heart Monitor QRS Beep (ECG Pulse)
  public playHeartbeatBeep(hr: number = 72) {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()

      // Pitch pitch shifts slightly with HR (higher HR = slightly higher pitch)
      const freq = 800 + Math.min(300, (hr - 60) * 4)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime)

      // Envelope: fast 5ms attack, 70ms exponential decay
      const now = this.ctx.currentTime
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.12, now + 0.005)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.08)
    } catch {
      // Audio context policy safe catch
    }
  }

  // 2. Urgent Medical Alert Alarm Chime
  public playAlertAlarm(severity: 'critical' | 'warning' = 'warning') {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const isCritical = severity === 'critical'

      // Dual tone medical chime (E5 -> A5 or high warning tone)
      const tones = isCritical ? [1046.5, 1318.5, 1046.5, 1318.5] : [880, 1108.73]
      const duration = isCritical ? 0.12 : 0.15

      tones.forEach((freq, index) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        osc.type = 'square'
        osc.frequency.setValueAtTime(freq, now + index * duration)

        const start = now + index * duration
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.08, start + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start(start)
        osc.stop(start + duration)
      })
    } catch {
      // Audio context safe catch
    }
  }

  // 3. Cyber UI Soft Interaction Click
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

      gain.gain.setValueAtTime(0.06, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03)

      osc.connect(gain)
      gain.connect(this.ctx.destination)

      osc.start(now)
      osc.stop(now + 0.035)
    } catch {
      // Audio context safe catch
    }
  }

  // 4. Alert Acknowledge / Task Confirmation Chime
  public playAckSound() {
    if (!this.enabled) return
    this.initCtx()
    if (!this.ctx) return

    try {
      const now = this.ctx.currentTime
      const notes = [587.33, 880] // D5 -> A5 upward resolution

      notes.forEach((freq, idx) => {
        if (!this.ctx) return
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        osc.type = 'sine'
        const start = now + idx * 0.08
        osc.frequency.setValueAtTime(freq, start)

        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(0.1, start + 0.01)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start(start)
        osc.stop(start + 0.14)
      })
    } catch {
      // Audio context safe catch
    }
  }
}

export const monitorAudio = new PatientMonitorAudio()
