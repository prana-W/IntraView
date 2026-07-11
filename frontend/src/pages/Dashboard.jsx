import { useEffect, useState } from 'react';

import TranscriptCard from '@/components/TranscriptCard';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Mic, FileText, Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

/* Skeleton card for loading state */
function SkeletonCard() {
    return (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 animate-pulse">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-1/3" />
            <div className="space-y-2 pt-1">
                <div className="h-3 bg-muted rounded w-full" />
                <div className="h-3 bg-muted rounded w-5/6" />
                <div className="h-3 bg-muted rounded w-4/6" />
            </div>
        </div>
    );
}

export default function Dashboard() {

    const [transcripts, setTranscripts] = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
    async function fetchTranscripts(isSilent = false) {
        if (!isSilent) setLoading(true);
        try {
            const data = await api.get('/transcripts');
            setTranscripts(data.transcripts || []);
        } catch (err) {
            if (!isSilent) toast.error(`Failed to load transcripts: ${err.message}`);
        } finally {
            if (!isSilent) setLoading(false);
        }
    }

    async function handleDelete(id) {
        try {
            await api.delete(`/transcripts/${id}`);
            setTranscripts(prev => prev.filter(t => t._id !== id));
            toast.success("Transcript deleted successfully");
        } catch (err) {
            toast.error(`Failed to delete transcript: ${err.message}`);
        }
    }

    async function handleDeleteAll() {
        setIsDeleteAllOpen(false);
        try {
            await api.delete('/transcripts');
            setTranscripts([]);
            toast.success("All transcripts deleted successfully");
        } catch (err) {
            toast.error(`Failed to delete all transcripts: ${err.message}`);
        }
    }
    useEffect(() => { 
        fetchTranscripts(); 
        const intervalId = setInterval(() => fetchTranscripts(true), 5000);
        return () => clearInterval(intervalId);
    }, []);

    return (
        <div className="w-full max-w-6xl mx-auto px-4 py-10">
            {/* Page header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">
                        My Transcripts
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        {!loading && `${transcripts.length} session${transcripts.length !== 1 ? 's' : ''}`}
                    </p>
                </div>
                {transcripts.length > 0 && (
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setIsDeleteAllOpen(true)}
                        disabled={loading}
                        className="gap-2 bg-red-600 hover:bg-red-700 text-white"
                    >
                        <Trash2 className="w-4 h-4" />
                        Delete All
                    </Button>
                )}
            </div>

            {/* Loading skeletons */}
            {loading && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
            )}

            {/* Transcript grid */}
            {!loading && transcripts.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {transcripts.map(t => (
                        <TranscriptCard key={t._id} transcript={t} onDelete={handleDelete} />
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && transcripts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
                    <div className="relative">
                        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Mic className="w-10 h-10 text-primary/60" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                    </div>
                    <div className="space-y-2 max-w-sm">
                        <h2 className="text-xl font-semibold">No transcripts yet</h2>
                        <p className="text-muted-foreground text-sm leading-relaxed">
                            Open LeetCode, click the <strong>IntraView Record</strong> button in the navbar,
                            explain your approach out loud, then stop. Your transcript will appear here.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-4 py-2 rounded-full">
                        <Download className="w-3.5 h-3.5" />
                        Install the Chrome extension to get started
                    </div>
                </div>
            )}
            <ConfirmDialog 
                isOpen={isDeleteAllOpen} 
                onClose={() => setIsDeleteAllOpen(false)}
                onConfirm={handleDeleteAll}
                title="Delete All Transcripts"
                description="Are you sure you want to delete all transcripts? This action cannot be undone and will permanently delete all associated audio files."
                confirmText="Delete All"
            />
        </div>
    );
}
