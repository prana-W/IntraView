import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Copy, Check, Clock, AlertCircle, Trash2, Code2, FileText } from 'lucide-react';
import { toast } from 'sonner';
import api, { BASE } from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';

const AI_PROMPT_TEMPLATE = (title, transcript, code, problemDesc) =>
`You are a senior software engineer and technical interviewer at a top-tier tech company (FAANG-level). Your job is to give an HONEST, CRITICAL, and UNBIASED evaluation of a candidate's interview performance. Do NOT be encouraging or diplomatic — your role is to give the kind of blunt, direct feedback that a real interviewer would give internally after the interview. If the candidate performed poorly, say so clearly. If they missed something obvious, call it out directly. Praise should be minimal and only given when genuinely earned.

You will be evaluating the candidate on their verbal explanation of their approach to the following problem:

═══════════════════════════════════════════════════════
PROBLEM: ${title}
═══════════════════════════════════════════════════════
${problemDesc ? `\n${problemDesc}\n` : '(Problem description not available)'}
═══════════════════════════════════════════════════════

${code ? `CANDIDATE'S ACCEPTED CODE:\n\`\`\`\n${code}\n\`\`\`\n\n═══════════════════════════════════════════════════════\n` : ''}
CANDIDATE'S VERBAL TRANSCRIPT (there may be minor transcription errors — use context to infer meaning, but do not excuse poor thinking because of them):
---
${transcript}
---

═══════════════════════════════════════════════════════
YOUR EVALUATION TASK
═══════════════════════════════════════════════════════

Produce a structured evaluation with ALL of the following sections. Be specific — reference exact parts of the transcript when making judgements.

---

## 🧠 SECTION 1 — Problem Comprehension (Score: X/10)

Did the candidate demonstrate they understood the problem correctly?
- Did they restate or paraphrase the problem before diving in?
- Did they identify constraints and their implications (e.g., input size → O(n log n) is fine, O(n²) is not)?
- Did they ask (or mention) clarifying questions about edge cases, input format, or constraints?
- Did they misunderstand anything?

**Score justification:** [Be specific. A score of 7+ requires demonstrated understanding of constraints.]

---

## 💡 SECTION 2 — Approach & Algorithm Quality (Score: X/10)

Evaluate the quality of the algorithmic thinking:
- Did they start with a brute force and then optimize, or jump straight to optimal?
- Is their described approach actually correct?
- Did they identify the right data structures and algorithms?
- Did they miss a simpler or more optimal solution?
- Rate the approach: Brute Force / Suboptimal / Optimal / Highly Optimal

**Score justification:** [Penalize heavily for incorrect approaches or missing obvious optimizations.]

---

## ⏱️ SECTION 3 — Complexity Analysis (Score: X/10)

- Did they analyze time complexity? Was it correct?
- Did they analyze space complexity? Was it correct?
- Did they discuss tradeoffs between time and space?
- If they gave wrong complexity, what is the correct one and why?

**Score justification:** [Missing complexity analysis entirely is a major red flag — score ≤ 4.]

---

## 🗣️ SECTION 4 — Communication & Verbal Clarity (Score: X/10)

- Was the explanation structured and easy to follow?
- Did they think out loud or were they silent and then just stated a solution?
- Did they use concrete examples to illustrate their approach?
- Were there long awkward pauses, repeated contradictions, or confused explanations?
- Was the pacing appropriate, or did they rush / ramble?

**Score justification:** [In a real interview, poor communication is an immediate concern regardless of correctness.]

---

## 🧪 SECTION 5 — Edge Case & Corner Case Awareness (Score: X/10)

- Did they proactively identify edge cases (empty input, single element, all duplicates, negative numbers, overflow, etc.)?
- Did they handle them in their explanation or code?
- Did they miss obvious edge cases?

List any edge cases they missed: [Be exhaustive]

**Score justification:**

---

## 🔍 SECTION 6 — Code Quality (Score: X/10) ${code ? '' : '— N/A (no accepted code submitted)'}

${code ? `Evaluate the actual submitted code:
- Is it clean and readable?
- Are variable names meaningful?
- Is there unnecessary complexity or repeated logic?
- Are there any bugs or potential issues?
- Does the code match what they verbally described?
- Is error handling appropriate?

**Score justification:**` : '*Skipped — candidate did not submit an accepted solution during this session.*'}

---

## 🧩 SECTION 7 — Problem-Solving Process & Structured Thinking (Score: X/10)

- Did they follow a logical, structured problem-solving process?
- Did they break the problem into smaller sub-problems?
- Did they validate their logic with examples before writing code?
- Did they course-correct when they made a mistake, or get stuck?
- Signs of strong process: restate → example → brute force → optimize → code → verify

**Score justification:**

---

## 💬 SECTION 8 — Interview Presence & Confidence (Score: X/10)

- Did the candidate sound confident and composed, or hesitant and uncertain?
- Did they hedge excessively ("I think maybe...", "I'm not sure but...")?
- Did they recover well from mistakes?
- Would an interviewer feel comfortable with this person representing the team?

**Score justification:** [This is a real evaluation criterion. Excessive self-doubt is penalizing.]

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

**Equivalent Rating:** [Choose one: Strong Hire / Hire / Lean Hire / Lean No-Hire / No-Hire / Strong No-Hire]

---

## 🚨 CRITICAL MISTAKES & MISSED OPPORTUNITIES

List every significant mistake, missed optimization, gap in explanation, or red flag. Be direct:
- [Mistake 1]
- [Mistake 2]
- ...

---

## ✅ WHAT ACTUALLY WENT WELL

Only list things that were genuinely done well. If nothing was impressive, say so. Do not pad this section.

---

## 📈 CONCRETE IMPROVEMENT PLAN

Give 3–5 specific, actionable steps this candidate should take to improve:
1. [Specific action with resources/method if applicable]
2. ...

---

## 🏁 FINAL VERDICT

Write 2–3 sentences summarizing the overall performance as an interviewer would in their internal debrief. Be direct and honest. Would you pass this candidate to the next round?`;


/** Convert "binary-tree-inorder-traversal" → "Binary Tree Inorder Traversal" */
function prettifySlug(slug = '') {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Unknown Problem';
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
        const full  = AI_PROMPT_TEMPLATE(
            title,
            transcript.audioTranscript || '(no transcript)',
            transcript.codeSnapshot || '',
            transcript.problemDescription || ''
        );
        navigator.clipboard.writeText(full).then(() => {
            setCopied(true);
            toast.success('Copied with AI review prompt! 🚀');
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

            {/* Transcript */}
            {lines.length === 0 ? (
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
                                {/* Timestamp */}
                                <span
                                    className={`shrink-0 font-mono text-xs w-16 text-right transition-colors select-none ${
                                        isActive
                                            ? 'text-primary font-semibold'
                                            : 'text-muted-foreground/60 group-hover:text-primary/70'
                                    }`}
                                >
                                    {line.timestamp || '—'}
                                </span>

                                {/* Divider */}
                                <span className={`shrink-0 w-px h-4 self-center transition-colors ${isActive ? 'bg-primary/40' : 'bg-border'}`} />

                                {/* Text */}
                                <p className={`text-sm leading-relaxed transition-colors ${isActive ? 'text-foreground font-medium' : 'text-foreground/90'}`}>
                                    {line.text}
                                </p>
                            </div>
                        );
                    })}
                </div>
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
