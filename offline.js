/* Saves the playroom and encrypted family files through its local worker.
   The worker owns cache names; this client only supplies relative file paths. */
class PlayroomOffline {
  #status; #serviceWorkers; #pageUrl; #paths; #started; #run; #workerReady;
  /** @param {{status: HTMLElement, serviceWorkers: ServiceWorkerContainer|undefined, pageUrl: string}} options */
  constructor({ status, serviceWorkers, pageUrl }) {
    this.#status = status;
    this.#serviceWorkers = serviceWorkers;
    this.#pageUrl = new URL(pageUrl);
    this.#paths = [];
    this.#started = false;
    this.#run = 0;
    this.#workerReady = null;
  }

  /** Register all encrypted media in a decrypted v1 manifest for offline saving. */
  includeFamily(manifest) {
    const items = [...(manifest.photos || []), ...(manifest.videos || [])];
    const parts = items.flatMap(item => [...item.parts, ...(item.poster ? item.poster.parts : [])]);
    this.#paths = [...new Set(['family/info.json', 'family/family.bin', ...parts.map(name => 'family/' + name)])];
    if (this.#started) this.save();
  }

  /** Save required files, reporting readiness only after every file is stored. */
  async save() {
    this.#started = true;
    const run = ++this.#run;
    if (this.#pageUrl.protocol === 'file:') {
      this.#show('Local copy — offline games available', 'local');
      return;
    }
    if (!this.#serviceWorkers) {
      this.#show('This browser cannot save offline play', 'unsupported');
      return;
    }
    this.#show('Saving for offline play…', 'saving');
    try {
      if (!this.#workerReady) this.#workerReady = this.#activateWorker();
      const worker = await this.#workerReady;
      await this.#saveFiles(worker, this.#paths, run);
      if (run === this.#run) this.#show('Saved for offline play', 'ready');
    } catch (error) {
      this.#workerReady = null;
      if (run === this.#run) this.#show('Offline save incomplete — reconnect and reopen', 'error');
    }
  }

  async #activateWorker() {
    const workerUrl = new URL('sw.js', this.#pageUrl);
    const registration = await this.#serviceWorkers.register(workerUrl.href, { updateViaCache: 'none' });
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) throw new Error('Offline worker unavailable');
    if (worker.state === 'activated') return worker;
    await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state !== 'activated' && worker.state !== 'redundant') return;
        worker.removeEventListener('statechange', changed);
        if (worker.state === 'activated') resolve();
        else reject(new Error('Offline installation failed'));
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
    return worker;
  }

  #saveFiles(worker, paths, run) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        channel.port1.close();
        if (error) reject(error); else resolve();
      };
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(new Error('Offline save timed out')), 90000);
      };
      channel.port1.onmessage = ({ data }) => {
        resetTimer();
        if (data.error) finish(new Error(data.error));
        else if (data.done) finish();
        else if (run === this.#run) this.#show('Saving for offline play… ' + data.saved + '/' + data.total, 'saving');
      };
      resetTimer();
      worker.postMessage({ type: 'SAVE_OFFLINE', paths }, [channel.port2]);
    });
  }

  #show(text, state) {
    this.#status.textContent = text;
    this.#status.dataset.state = state;
  }
}
