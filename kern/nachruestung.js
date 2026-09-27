// Nachrüstung für ältere Safari-Versionen (iOS 26 und früher).
//
// pdf.js liest den Seitentext mit `for await (const teil of stream)`. Das setzt
// voraus, dass ein ReadableStream asynchron durchlaufen werden kann — Safari kann
// das erst ab Version 27. Ohne diese Zeilen scheitert auf einem iPhone mit iOS 26
// JEDES Angebot mit „undefined is not a function (near '...t of e...')".
//
// Wird im Hauptprogramm und im pdf.js-Worker vor pdf.js geladen.

const RS = globalThis.ReadableStream;
if (RS && !RS.prototype[Symbol.asyncIterator]) {
  RS.prototype.values = function values({ preventCancel = false } = {}) {
    const leser = this.getReader();
    return {
      async next() {
        try {
          const r = await leser.read();
          if (r.done) leser.releaseLock();
          return r;
        } catch (e) {
          leser.releaseLock();
          throw e;
        }
      },
      async return(wert) {
        if (!preventCancel) {
          const abbruch = leser.cancel(wert);
          leser.releaseLock();
          await abbruch;
        } else {
          leser.releaseLock();
        }
        return { done: true, value: wert };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  RS.prototype[Symbol.asyncIterator] = RS.prototype.values;
}
