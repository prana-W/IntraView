import mongoose from "mongoose";

const transcriptSchema = new mongoose.Schema({
  sessionId:       { type: String },
  problemTitle:    { type: String, default: "unknown" },   // slug from URL
  problemLink:     { type: String, default: "" },
  audioTranscript:    { type: String, default: "" },          // all chunk texts joined
  codeSnapshot:       { type: String, default: "" },          // accepted submission code
  problemDescription: { type: String, default: "" },          // problem statement text from LeetCode
}, { timestamps: true });

export default mongoose.model("Transcript", transcriptSchema);
