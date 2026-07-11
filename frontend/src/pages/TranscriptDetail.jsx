import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Copy, Check, Clock, AlertCircle, Trash2, Code2, FileText, Bot, Mic2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { BASE } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

/**
 * Build the AI analysis prompt.
 * For interview sessions (interviewTurns present): formats as structured Q&A
 * so the AI evaluates each answer in context of the specific question asked.
 * For legacy recordings: uses the original flat transcript format.
 */
const STAGE_LABELS = {
  INTRO: 'Introduction', APPROACH: 'Approach', COMPLEXITY: 'Complexity',
  CODING: 'Coding', REVIEW: 'Code Review', CLOSE: 'Wrap-up',
};

function buildInterviewQAText(turns = []) {
  if (!turns.length) return '';
  const lines = [];
  let lastStage = null;
  turns.forEach(t => {
    if (t.stage && t.stage !== lastStage) {
      lines.push(`\n── ${STAGE_LABELS[t.stage] || t.stage} ──`);
      lastStage = t.stage;
    }
    const prefix = t.role === 'ai' ? '🤖 Interviewer' : '👤 Candidate';
    lines.push(`${prefix}: "${t.text}"`);
  });
  return lines.join('\n');
}

const AI_PROMPT_TEMPLATE = (title, transcript, code, problemDesc, interviewTurns) => {
  const isInterview = interviewTurns && interviewTurns.length > 0;
  const qaText = isInterview ? buildInterviewQAText(interviewTurns) : null;

  return `You are a senior software engineer and technical interviewer at a top-tier tech company (FAANG-level). Your job is to give an HONEST, CRITICAL, and UNBIASED evaluation of a candidate's interview performance. Do NOT be encouraging or diplomatic. If the candidate performed poorly, say so clearly. Praise should be minimal and only given when genuinely earned.

PROBLEM: ${title}
${'═'.repeat(55)}
${problemDesc || '(Problem description not available)'}
${'═'.repeat(55)}

${code ? `CANDIDATE'S ACCEPTED CODE:\n\`\`\`\n${code}\n\`\`\`\n${'═'.repeat(55)}\n` : ''}${isInterview ? `
INTERVIEW TRANSCRIPT (structured Q&A — evaluate each candidate response in context of the specific question the interviewer asked):
${'─'.repeat(55)}
${qaText}
${'─'.repeat(55)}

⚠️ IMPORTANT: For each section below, reference WHICH interviewer question the candidate was responding to when making judgements. Score their answer quality relative to that specific question — not just in isolation.
` : `
CANDIDATE'S VERBAL TRANSCRIPT (minor transcription errors may exist — use context to infer meaning):
---
${transcript}
---
`}
${'═'.repeat(55)}
YOUR EVALUATION TASK
${'═'.repeat(55)}

Produce a structured evaluation with ALL of the following sections. Be specific — reference exact parts of the transcript.

---

## 🧠 SECTION 1 — Problem Comprehension (Score: X/10)
${isInterview ? '\n**Evaluate the INTRO stage response**: Did they correctly explain the problem back?' : ''}
- Did they restate or paraphrase the problem before diving in?
- Did they identify constraints and their implications?
- Did they ask (or mention) clarifying questions about edge cases?
- Did they misunderstand anything?

**Score justification:** [Be specific. 7+ requires demonstrated understanding of constraints.]

---

## 💡 SECTION 2 — Approach & Algorithm Quality (Score: X/10)
${isInterview ? '\n**Evaluate the APPROACH stage response**: How well did they answer "walk me through your approach"?' : ''}
- Did they start with brute force then optimize, or jump straight to optimal?
- Is their described approach actually correct?
- Did they identify the right data structures and algorithms?
- Rate the approach: Brute Force / Suboptimal / Optimal / Highly Optimal

**Score justification:** [Penalize heavily for incorrect approaches.]

---

## ⏱️ SECTION 3 — Complexity Analysis (Score: X/10)
${isInterview ? '\n**Evaluate the COMPLEXITY stage response**: Did they correctly answer the complexity question?' : ''}
- Did they analyze time complexity? Was it correct?
- Did they analyze space complexity? Was it correct?
- Did they discuss tradeoffs?

**Score justification:** [Missing complexity analysis entirely → score ≤ 4.]

---

## 🗣️ SECTION 4 — Communication & Verbal Clarity (Score: X/10)
- Was the explanation structured and easy to follow?
- Did they use concrete examples?
- Were there long awkward pauses, contradictions, or confused explanations?

**Score justification:**

---

## 🧪 SECTION 5 — Edge Case & Corner Case Awareness (Score: X/10)
${isInterview ? '\n**Evaluate the REVIEW stage response**: Did they identify edge cases when asked?' : ''}
- Did they proactively identify edge cases (empty input, single element, overflow, etc.)?
- Did they miss obvious edge cases? List them.

**Score justification:**

---

## 🔍 SECTION 6 — Code Quality (Score: X/10) ${code ? '' : '— N/A'}

${code ? `Evaluate the actual submitted code:
- Is it clean and readable? Variable names meaningful?
- Any bugs or potential issues?
- Does the code match what they verbally described?

**Score justification:**` : '*Skipped — no accepted code submitted.*'}

---

## 🧩 SECTION 7 — Problem-Solving Process (Score: X/10)
- Did they follow a logical structured process?
- Signs of strong process: restate → example → brute force → optimize → code → verify

**Score justification:**

---

## 💬 SECTION 8 — Interview Presence & Confidence (Score: X/10)
- Confident and composed, or hesitant and uncertain?
- Did they recover well from mistakes?

**Score justification:**

---

## 📊 OVERALL SCORECARD

| Parameter | Score |
|---|---|
| Problem Comprehension | X/10 |
| Approach & Algorithm Quality | X/10 |
| Complexity Analysis | X/10 |
| Communication & Verbal Clarity | X/10 |
| Edge Case Awareness | X/10 |
| Code Quality | X/10 or N/A |
| Problem-Solving Process | X/10 |
| Interview Presence | X/10 |
| **OVERALL** | **XX/80** |

**Equivalent Rating:** [Strong Hire / Hire / Lean Hire / Lean No-Hire / No-Hire / Strong No-Hire]

---

## 🚨 CRITICAL MISTAKES & MISSED OPPORTUNITIES

List every significant mistake, missed optimization, gap in explanation, or red flag:
- [Mistake 1]
- ...

---

## ✅ WHAT ACTUALLY WENT WELL

Only list genuinely impressive things. Do not pad this section.

---

## 📈 CONCRETE IMPROVEMENT PLAN

Give 3–5 specific, actionable steps:
1. [Action]
2. ...

---

## 🏁 FINAL VERDICT

2–3 sentences as an interviewer's internal debrief. Would you pass this candidate to the next round?`;
};


/** Convert "binary-tree-inorder-traversal" → "Binary Tree Inorder Traversal" */
function prettifySlug(slug = '') {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Unknown Problem';
}

// Stage colour map (matches interview.config.js)
const STAGE_COLORS = {
  INTRO: '#38bdf8', APPROACH: '#a78bfa', COMPLEXITY: '#34d399',
  CODING: '#fb923c', REVIEW: '#f472b6', CLOSE: '#facc15',
};
const ALL_STAGES = ['INTRO', 'APPROACH', 'COMPLEXITY', 'CODING', 'REVIEW', 'CLOSE'];

/** Chat-style interview transcript view */
function InterviewView({ turns = [], summary }) {
    let lastStage = null;
    return (
        <div className="space-y-3">
            {summary && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-6">
                    <p className="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-1">AI Post-Interview Summary</p>
                    <p className="text-sm text-foreground/90 leading-relaxed">{summary}</p>
                </div>
            )}

            {/* Stage progress bar */}
            <div className="flex items-center gap-2 mb-6 flex-wrap">
                {ALL_STAGES.map(stage => {
                    const done = turns.some(t => t.stage === stage);
                    const color = STAGE_COLORS[stage] || '#6366f1';
                    return (
                        <div key={stage} className="flex items-center gap-1.5">
                            <div
                                className="w-2.5 h-2.5 rounded-full transition-all"
                                style={{ background: done ? color : 'hsl(var(--muted))' }}
                            />
                            <span className="text-xs" style={{ color: done ? color : 'hsl(var(--muted-foreground))' }}>
                                {STAGE_LABELS[stage]}
                            </span>
                        </div>
                    );
                })}
            </div>

            {turns.map((turn, idx) => {
                const stageChanged = turn.stage && turn.stage !== lastStage;
                if (stageChanged) lastStage = turn.stage;
                const isAI   = turn.role === 'ai';
                const color  = STAGE_COLORS[turn.stage] || '#6366f1';

                return (
                    <div key={idx}>
                        {stageChanged && (
                            <div className="flex items-center gap-3 my-5">
                                <div className="h-px flex-1 bg-border" />
                                <span
                                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
                                    style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}
                                >
                                    {STAGE_LABELS[turn.stage] || turn.stage}
                                </span>
                                <div className="h-px flex-1 bg-border" />
                            </div>
                        )}
                        <div className={`flex gap-3 ${ isAI ? 'flex-row' : 'flex-row-reverse' }`}>
                            {/* Avatar */}
                            <div
                                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                                style={{ background: isAI ? `${color}22` : 'hsl(var(--muted))' }}
                            >
                                {isAI
                                    ? <Bot className="w-4 h-4" style={{ color }} />
                                    : <Mic2 className="w-4 h-4 text-muted-foreground" />
                                }
                            </div>
                            {/* Bubble */}
                            <div
                                className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                                    isAI
                                        ? 'rounded-tl-sm bg-card border border-border text-foreground'
                                        : 'rounded-tr-sm bg-muted text-foreground/90'
                                }`}
                            >
                                <p className="text-[10px] font-semibold mb-1 opacity-50 uppercase tracking-wider">
                                    {isAI ? 'Interviewer' : 'You'}
                                </p>
                                {turn.text}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * LeetCode prepends line numbers directly onto each line (e.g. "1class Solution {").
 * Split into { num: string, code: string } per line.
 */
function parseCodeLines(raw = '') {
    return raw.split('\n').map(line => {
        const m = line.match(/^(\d+)(.*)$/);
        if (m) return { num: m[1], code: m[2] };
        return { num: '', code: line };
    });
}

function formatDateTime(iso) {
    return new Date(iso).toLocaleString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
    });
}

/** Parse raw transcript lines — each line is "[HH:MM:SS] some text" */
function parseLines(raw = '') {
    return raw
        .split('\n')
        .map(line => {
            const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s*(.+)$/);
            if (m) {
                const seconds = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
                return { timestamp: `${m[1]}:${m[2]}:${m[3]}`, seconds, text: m[4] };
            }
            if (line.trim()) return { timestamp: null, seconds: null, text: line.trim() };
            return null;
        })
        .filter(Boolean);
}

/** Given current audio time and parsed lines, return the index of the active line */
function getActiveIndex(lines, currentTime) {
    if (currentTime == null || lines.length === 0) return -1;
    let active = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].seconds == null) continue;
        if (currentTime >= lines[i].seconds) active = i;
        else break;
    }
    return active;
}

export default function TranscriptDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [transcript, setTranscript] = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState(null);
    const [copied,     setCopied]     = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [activeIdx,  setActiveIdx]  = useState(-1);
    const [codeCopied, setCodeCopied] = useState(false);
    const [showCode,    setShowCode]   = useState(false);
    const [showProblem, setShowProblem] = useState(false);

    const audioRef      = useRef(null);
    const lineRefs      = useRef([]);
    const userScrolling = useRef(false);
    const scrollTimer   = useRef(null);

    useEffect(() => {
        api.get(`/transcripts/${id}`)
            .then(data => setTranscript(data.transcript))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [id]);

    /* ── Audio time tracking ── */
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !transcript) return;

        const lines = parseLines(transcript.audioTranscript);

        const onTimeUpdate = () => {
            const idx = getActiveIndex(lines, audio.currentTime);
            setActiveIdx(idx);

            // Auto-scroll only if user isn't manually scrolling
            if (!userScrolling.current && idx >= 0 && lineRefs.current[idx]) {
                lineRefs.current[idx].scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                });
            }
        };

        audio.addEventListener('timeupdate', onTimeUpdate);
        return () => audio.removeEventListener('timeupdate', onTimeUpdate);
    }, [transcript]);

    /* ── Detect manual scroll to pause auto-scroll briefly ── */
    useEffect(() => {
        const onScroll = () => {
            userScrolling.current = true;
            clearTimeout(scrollTimer.current);
            scrollTimer.current = setTimeout(() => {
                userScrolling.current = false;
            }, 3000);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const handleCopy = useCallback(() => {
        if (!transcript) return;
        const title = prettifySlug(transcript.problemTitle);
        const isInterview = transcript.interviewTurns?.length > 0;
        const full  = AI_PROMPT_TEMPLATE(
            title,
            transcript.audioTranscript || '(no transcript)',
            transcript.codeSnapshot || '',
            transcript.problemDescription || '',
            isInterview ? transcript.interviewTurns : null
        );
        navigator.clipboard.writeText(full).then(() => {
            setCopied(true);
            toast.success(isInterview ? 'Copied interview Q&A prompt! 🚀' : 'Copied with AI review prompt! 🚀');
            setTimeout(() => setCopied(false), 2500);
        }).catch(() => toast.error('Failed to copy'));
    }, [transcript]);

    const handleCodeCopy = useCallback(() => {
        if (!transcript?.codeSnapshot) return;
        navigator.clipboard.writeText(transcript.codeSnapshot).then(() => {
            setCodeCopied(true);
            toast.success('Code copied!');
            setTimeout(() => setCodeCopied(false), 2500);
        }).catch(() => toast.error('Failed to copy code'));
    }, [transcript]);

    const handleDelete = useCallback(async () => {
        if (!transcript) return;
        setIsDeleting(true);
        try {
            await api.delete(`/transcripts/${transcript._id}`);
            toast.success("Transcript deleted successfully");
            navigate('/');
        } catch (err) {
            toast.error(`Failed to delete: ${err.message}`);
            setIsDeleting(false);
        }
    }, [transcript, navigate]);

    /** Seek audio to a line's timestamp on click */
    const seekTo = useCallback((seconds) => {
        if (audioRef.current && seconds != null) {
            audioRef.current.currentTime = seconds;
            audioRef.current.play().catch(() => {});
        }
    }, []);

    /* ── Loading ── */
    if (loading) {
        return (
            <div className="w-full max-w-4xl mx-auto px-4 py-10 space-y-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-24" />
                <div className="h-8 bg-muted rounded w-2/3" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="space-y-3 pt-6">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex gap-3">
                            <div className="h-3.5 bg-muted rounded w-20 shrink-0" />
                            <div className={`h-3.5 bg-muted rounded ${i % 3 === 0 ? 'w-full' : i % 3 === 1 ? 'w-5/6' : 'w-4/6'}`} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /* ── Error ── */
    if (error) {
        return (
            <div className="w-full max-w-4xl mx-auto px-4 py-10">
                <div className="flex flex-col items-center gap-4 py-20 text-center">
                    <AlertCircle className="w-12 h-12 text-destructive/60" />
                    <p className="text-destructive font-medium">{error}</p>
                    <Button variant="outline" onClick={() => navigate('/')}>← Back to Dashboard</Button>
                </div>
            </div>
        );
    }

    if (!transcript) return null;

    const title = prettifySlug(transcript.problemTitle);
    const lines = parseLines(transcript.audioTranscript);

    return (
        <div className="w-full max-w-4xl mx-auto px-4 py-10">
            {/* Back button */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/')}
                className="mb-6 gap-2 text-muted-foreground hover:text-foreground -ml-2"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </Button>

            {/* Header */}
            <div className="mb-8">
                <div className="flex items-start justify-between gap-4">
                    <h1 className="text-3xl font-bold tracking-tight leading-tight">{title}</h1>
                    <div className="flex gap-2">
                        <Button
                            variant="destructive"
                            onClick={() => setShowDeleteDialog(true)}
                            disabled={isDeleting}
                            className="shrink-0 gap-2 shadow-sm"
                        >
                            <Trash2 className="w-4 h-4" /> Delete
                        </Button>
                        <Button
                            onClick={handleCopy}
                            className="shrink-0 gap-2 shadow-lg shadow-primary/25"
                            disabled={copied}
                        >
                            {copied
                                ? <><Check className="w-4 h-4" /> Copied!</>
                                : <><Copy className="w-4 h-4" /> Copy with AI Prompt</>
                            }
                        </Button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDateTime(transcript.createdAt)}
                    </span>
                    {transcript.problemLink && (
                        <Link
                            to={transcript.problemLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 hover:text-primary transition-colors"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            View on LeetCode
                        </Link>
                    )}
                    <span className="ml-auto text-xs">
                        {lines.length} chunk{lines.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>


            {/* Divider */}
            <div className="border-t border-border mb-8" />

            {/* Audio Player */}
            {transcript.sessionId && (
                <div className="mb-8 p-4 rounded-xl border border-border bg-card shadow-sm">
                    <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                        Listen to Recording
                    </h3>
                    <audio ref={audioRef} controls className="w-full outline-none">
                        <source src={`${BASE}/audio/${transcript.sessionId}.wav`} type="audio/wav" />
                        <source src={`${BASE}/audio/${transcript.sessionId}.webm`} type="audio/webm" />
                    </audio>
                </div>
            )}

            {/* Problem Description */}
            {transcript.problemDescription && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" />
                            Problem
                        </h3>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowProblem(v => !v)}
                            className="gap-1.5 h-7 text-xs text-muted-foreground"
                        >
                            {showProblem ? 'Hide problem' : 'Show problem'}
                        </Button>
                    </div>
                    {showProblem && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
                                <div className="w-2 h-2 rounded-full bg-primary" />
                                <span className="text-xs text-muted-foreground font-medium">Problem statement</span>
                            </div>
                            <pre className="overflow-x-auto p-4 text-[13px] text-foreground font-sans leading-relaxed max-h-96 whitespace-pre-wrap">
                                {transcript.problemDescription}
                            </pre>
                        </div>
                    )}
                </div>
            )}

            {/* Code Snapshot — only shown when user had an accepted submission */}
            {transcript.codeSnapshot && (
                <div className="mb-8">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Code2 className="w-4 h-4 text-green-500" />
                            Accepted Code
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowCode(v => !v)}
                                className="gap-1.5 h-7 text-xs text-muted-foreground"
                            >
                                {showCode ? 'Hide code' : 'Show code'}
                            </Button>
                            {showCode && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCodeCopy}
                                    className="gap-1.5 h-7 text-xs text-muted-foreground"
                                >
                                    {codeCopied
                                        ? <><Check className="w-3 h-3" /> Copied!</>
                                        : <><Copy className="w-3 h-3" /> Copy</>
                                    }
                                </Button>
                            )}
                        </div>
                    </div>
                    {showCode && (
                        <div className="relative rounded-xl border border-green-500/20 bg-[#0d1117] overflow-hidden">
                            <div className="flex items-center gap-2 px-4 py-2 border-b border-green-500/10 bg-green-500/5">
                                <div className="w-2 h-2 rounded-full bg-green-500" />
                                <span className="text-xs text-green-500/80 font-medium">Accepted submission</span>
                            </div>
                            <div className="overflow-x-auto overflow-y-auto max-h-96">
                                <table className="w-full border-collapse">
                                    <tbody>
                                        {parseCodeLines(transcript.codeSnapshot).map((line, i) => (
                                            <tr key={i} className="group hover:bg-white/[0.03] transition-colors">
                                                {/* Line number gutter */}
                                                <td className="select-none text-right pr-4 pl-4 py-0.5 border-r border-white/[0.06] w-12 shrink-0"
                                                    style={{ color: `hsl(${200 + (i * 7) % 60}, 60%, 55%)`, opacity: 0.6 }}>
                                                    <span className="font-mono text-[11px]">{line.num || i + 1}</span>
                                                </td>
                                                {/* Code */}
                                                <td className="pl-5 pr-4 py-0.5">
                                                    <span className="font-mono text-[12px] text-[#e6edf3] whitespace-pre">{line.code}</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Interview mode: chat-style Q&A view ── */}
            {transcript.interviewTurns?.length > 0 ? (
                <InterviewView
                    turns={transcript.interviewTurns}
                    summary={transcript.interviewSummary}
                />
            ) : (
                /* ── Legacy mode: timestamped transcript ── */
                lines.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">
                        <p>No transcript was recorded for this session.</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {lines.map((line, idx) => {
                            const isActive = idx === activeIdx;
                            return (
                                <div
                                    key={idx}
                                    ref={el => lineRefs.current[idx] = el}
                                    onClick={() => seekTo(line.seconds)}
                                    className={`group flex gap-4 items-baseline py-2.5 px-3 rounded-lg transition-all duration-300 ${
                                        line.seconds != null ? 'cursor-pointer' : ''
                                    } ${
                                        isActive
                                            ? 'bg-primary/10 border border-primary/20 shadow-sm'
                                            : 'hover:bg-muted/50 border border-transparent'
                                    }`}
                                    title={line.seconds != null ? `Seek to ${line.timestamp}` : undefined}
                                >
                                    <span className={`shrink-0 font-mono text-xs w-16 text-right transition-colors select-none ${
                                        isActive ? 'text-primary font-semibold' : 'text-muted-foreground/60 group-hover:text-primary/70'
                                    }`}>
                                        {line.timestamp || '—'}
                                    </span>
                                    <span className={`shrink-0 w-px h-4 self-center transition-colors ${isActive ? 'bg-primary/40' : 'bg-border'}`} />
                                    <p className={`text-sm leading-relaxed transition-colors ${isActive ? 'text-foreground font-medium' : 'text-foreground/90'}`}>
                                        {line.text}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                )
            )}
            
            <ConfirmDialog 
                isOpen={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={handleDelete}
                title="Delete Transcript"
                description="Are you sure you want to permanently delete this transcript and its associated audio file? This action cannot be undone."
            />
        </div>
    );
}
