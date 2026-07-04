import mongoose from "mongoose";

const transcriptSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  problemTitle:    { type: String, default: "unknown" },   // slug from URL
  problemLink:     { type: String, default: "" },
  audioTranscript: { type: String, default: "" },          // all chunk texts joined
}, { timestamps: true });

export default mongoose.model("Transcript", transcriptSchema);
