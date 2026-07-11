import mongoose from "mongoose";

const interviewTurnSchema = new mongoose.Schema({
  role:      { type: String, enum: ["ai", "user"], required: true },
  text:      { type: String, default: "" },
  stage:     { type: String, default: "" },
  timestamp: { type: Date,   default: Date.now },
}, { _id: false });

const transcriptSchema = new mongoose.Schema({
  sessionId:          { type: String },
  problemTitle:       { type: String, default: "unknown" }, // slug from URL
  problemLink:        { type: String, default: "" },
  audioTranscript:    { type: String, default: "" },        // legacy: all chunk texts joined
  codeSnapshot:       { type: String, default: "" },        // accepted submission code
  problemDescription: { type: String, default: "" },        // problem statement text from LeetCode

  // ── Interview mode fields (optional — absent on legacy recordings) ──────────
  interviewTurns:    { type: [interviewTurnSchema], default: undefined }, // structured Q&A pairs
  interviewSummary:  { type: String, default: "" },                       // post-session AI feedback
}, { timestamps: true });

export default mongoose.model("Transcript", transcriptSchema);
