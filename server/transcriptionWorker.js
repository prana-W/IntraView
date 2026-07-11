import { parentPort } from "worker_threads";
import { pipeline } from "@xenova/transformers";

let transcriber = null;

async function init() {
  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-medium.en",
      { quantized: true }
    );
    parentPort.postMessage({ type: "ready" });
  } catch (err) {
    parentPort.postMessage({ type: "error", id: "init", error: err.message });
  }
}

init();

parentPort.on("message", async (msg) => {
  if (msg.type === "transcribe") {
    try {
      // msg.samples is a Float32Array
      const result = await transcriber(msg.samples, { sampling_rate: 16000 });
      parentPort.postMessage({ 
        type: "result", 
        id: msg.id, 
        text: (result?.text ?? "").trim() 
      });
    } catch (err) {
      parentPort.postMessage({ 
        type: "error", 
        id: msg.id, 
        error: err.message 
      });
    }
  }
});
