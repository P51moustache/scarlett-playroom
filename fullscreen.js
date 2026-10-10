/* Landscape uses the whole display when the browser allows it.
   Rotation is not a tap: wait for the next gesture if activation is required. */
class PlayroomFullscreen {
  #document; #landscape; #activation; #started = false;
  #entering = false; #exiting = false; #wasFullscreen = false; #dismissed = false;

  /** @param {{document: Document, landscape: MediaQueryList, activation: UserActivation|undefined}} options */
  constructor({ document, landscape, activation }) {
    this.#document = document;
    this.#landscape = landscape;
    this.#activation = activation;
  }

  /** Watch rotation and ordinary play gestures. Never locks orientation or consumes a tap. */
  start() {
    if (this.#started) return;
    this.#started = true;
    if (this.#landscape.addEventListener) this.#landscape.addEventListener('change', this.#onOrientation);
    else this.#landscape.addListener(this.#onOrientation);
    for (const type of ['pointerup', 'click', 'keydown']) {
      this.#document.addEventListener(type, this.#onGesture, { capture: true, passive: true });
    }
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.#document.addEventListener(type, this.#onFullscreen);
    }
    this.#enter();
  }

  /** Remove watchers and leave only the fullscreen session owned by this controller. */
  stop() {
    this.#started = false;
    if (this.#landscape.removeEventListener) this.#landscape.removeEventListener('change', this.#onOrientation);
    else this.#landscape.removeListener(this.#onOrientation);
    for (const type of ['pointerup', 'click', 'keydown']) {
      this.#document.removeEventListener(type, this.#onGesture, true);
    }
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      this.#document.removeEventListener(type, this.#onFullscreen);
    }
    this.#leave();
  }

  #onOrientation = () => {
    this.#dismissed = false;
    if (this.#landscape.matches) this.#enter();
    else this.#leave();
  };

  #onGesture = (event) => {
    if (!event.isTrusted) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    this.#enter();
  };

  #onFullscreen = () => {
    const active = this.#ownsFullscreen();
    // Respect a deliberate exit until the tablet changes orientation again.
    if (this.#wasFullscreen && !active && this.#landscape.matches) this.#dismissed = true;
    this.#wasFullscreen = active;
    if (active && !this.#landscape.matches) this.#leave();
  };

  #fullscreenElement() {
    return this.#document.fullscreenElement || this.#document.webkitFullscreenElement;
  }

  #ownsFullscreen() {
    return this.#fullscreenElement() === this.#document.documentElement;
  }

  #enter() {
    const doc = this.#document, root = doc.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled;
    if (!this.#started || !this.#landscape.matches || this.#dismissed || this.#entering || this.#exiting) return;
    if (!request || enabled === false || doc.hidden || this.#fullscreenElement()) return;
    if (doc.activeElement?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (this.#activation && !this.#activation.isActive) return;
    this.#entering = true;
    try {
      Promise.resolve(request.call(root, { navigationUI: 'hide' }))
        .catch(() => {})
        .finally(() => {
          this.#entering = false;
          if (!this.#started || !this.#landscape.matches) this.#leave();
        });
    } catch {
      this.#entering = false;
    }
  }

  #leave() {
    const doc = this.#document;
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (!this.#ownsFullscreen() || !exit || this.#exiting) return;
    this.#exiting = true;
    try {
      Promise.resolve(exit.call(doc)).catch(() => {}).finally(() => { this.#exiting = false; });
    } catch {
      this.#exiting = false;
    }
  }
}
