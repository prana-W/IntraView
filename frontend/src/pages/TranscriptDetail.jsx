import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Copy, Check, Clock, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

const AI_PROMPT_TEMPLATE = (title, transcript) =>
`Act as an interviewer and review my approach for the problem: ${title} on LeetCode.
The below contains the entire transcript of my explanation. Analyze every line (ignore fillers and there might be some transcription errors, but ignore those) and give me a detailed review of my approach — what was good, what could have been improved, any missed edge cases, and overall quality of my verbal explanation.

---
${transcript}`;

/** Convert "binary-tree-inorder-traversal" → "Binary Tree Inorder Traversal" */
function prettifySlug(slug = '') {
    return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Unknown Problem';
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
            const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.+)$/);
            if (m) return { timestamp: m[1], text: m[2] };
            if (line.trim()) return { timestamp: null, text: line.trim() };
            return null;
        })
        .filter(Boolean);
}

export default function TranscriptDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [transcript, setTranscript] = useState(null);
    const [loading,    setLoading]    = useState(true);
    const [error,      setError]      = useState(null);
    const [copied,     setCopied]     = useState(false);

    useEffect(() => {
        api.get(`/transcripts/${id}`)
            .then(data => setTranscript(data.transcript))
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [id]);

    const handleCopy = useCallback(() => {
        if (!transcript) return;
        const title = prettifySlug(transcript.problemTitle);
        const full  = AI_PROMPT_TEMPLATE(title, transcript.audioTranscript || '(no transcript)');
        navigator.clipboard.writeText(full).then(() => {
            setCopied(true);
            toast.success('Copied with AI review prompt! 🚀');
            setTimeout(() => setCopied(false), 2500);
        }).catch(() => toast.error('Failed to copy'));
    }, [transcript]);

    /* ── Loading ── */
    if (loading) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-10 space-y-6 animate-pulse">
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
            <div className="max-w-4xl mx-auto px-4 py-10">
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
        <div className="max-w-4xl mx-auto px-4 py-10">
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

            {/* AI Prompt preview box */}
            <div className="mb-8 p-4 rounded-xl border border-primary/20 bg-primary/5 text-sm text-muted-foreground leading-relaxed">
                <p className="font-medium text-foreground mb-1">What "Copy with AI Prompt" sends:</p>
                <p className="italic">
                    "Act as an interviewer and review my approach for <strong className="not-italic text-primary">{title}</strong> on LeetCode.
                    Analyze every line, ignore fillers and transcription errors, and give a detailed review…"
                </p>
            </div>

            {/* Divider */}
            <div className="border-t border-border mb-8" />

            {/* Transcript */}
            {lines.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                    <p>No transcript was recorded for this session.</p>
                </div>
            ) : (
                <div className="space-y-1">
                    {lines.map((line, idx) => (
                        <div
                            key={idx}
                            className="group flex gap-4 items-baseline py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                            {/* Timestamp */}
                            <span className="shrink-0 font-mono text-xs text-muted-foreground/60 group-hover:text-primary/70 transition-colors w-16 text-right">
                                {line.timestamp || '—'}
                            </span>

                            {/* Divider */}
                            <span className="shrink-0 w-px h-4 bg-border self-center" />

                            {/* Text */}
                            <p className="text-sm leading-relaxed text-foreground/90">
                                {line.text}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
