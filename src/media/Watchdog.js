// src/media/Watchdog.js — spec §7.3 (verbatim). One-shot 8 s, tir unique.
export class MediaWatchdog {
  constructor(adapter) {
    this.adapter = adapter;
    this.timer = null;
    this.lastTime = 0;
    this.stalledSeconds = 0;
    this.fired = false;
  }

  start(requestId) {
    this.stop();
    this.fired = false;
    this.timer = setInterval(() => {
      if (this.fired || this.adapter.currentRequestId !== requestId) return;
      const video = this.adapter.videoEl;
      if (!video || video.paused) return;
      if (video.currentTime === this.lastTime && video.readyState < 3) {
        this.stalledSeconds += 1;
        if (this.stalledSeconds >= 8) {
          this.fired = true;   // tir unique : pas de rafale de handleStallTimeout
          this.stop();
          this.adapter.handleStallTimeout();
        }
      } else {
        this.lastTime = video.currentTime;
        this.stalledSeconds = 0;
      }
    }, 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stalledSeconds = 0;
  }
}
