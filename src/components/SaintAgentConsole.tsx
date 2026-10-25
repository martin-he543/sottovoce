import { ArgonButton, ArgonTag } from './ArgonButton';
import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Link2,
  ArrowUpRight,
  Clock,
  FileCheck2,
  AlertTriangle,
  Coffee,
  Navigation,
} from 'lucide-react';
import type { SaintHitlTask, LiveEvent, CivicNode } from '../types/sottovoce';

interface SaintAgentConsoleProps {
  tasks: SaintHitlTask[];
  liveEvents: LiveEvent[];
  civicNodes: CivicNode[];
  onIngestUrl: (url: string) => Promise<void>;
  onResolveHitlTask: (taskId: string, decision: 'approve' | 'reject') => Promise<void>;
  isIngesting: boolean;
}

const SAMPLE_INGEST_PRESETS = [
  {
    label: 'Luma · Royal Opera House Late Rehearsal (Covent Garden)',
    url: 'https://lu.ma/roh-tosca-late-rehearsal-covent-garden',
  },
  {
    label: 'Bandsintown · Nils Frahm & Joe Hisaishi Barbican Session',
    url: 'https://www.bandsintown.com/e/103948219-joe-hisaishi-at-barbican-hall-london',
  },
  {
    label: 'Royal Ballet & Opera · Don Giovanni Under-35s Night',
    url: 'https://www.rbo.org.uk/tickets-and-events/don-giovanni-under35-night',
  },
];

export const SaintAgentConsole: React.FC<SaintAgentConsoleProps> = ({
  tasks,
  liveEvents,
  onIngestUrl,
  onResolveHitlTask,
  isIngesting,
}) => {
  const [urlInput, setUrlInput] = useState(SAMPLE_INGEST_PRESETS[0].url);
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleSubmitIngestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError(
        'Please paste an event URL from Luma, Bandsintown, Eventbrite, or a London theatre.'
      );
      return;
    }
    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      if (!parsed.hostname.includes('.')) {
        setUrlError('URL must include a valid domain name (e.g. lu.ma or bandsintown.com).');
        return;
      }
    } catch {
      setUrlError('Please enter a valid HTTP/HTTPS event URL.');
      return;
    }

    await onIngestUrl(trimmed);
  };

  const handleResolve = async (taskId: string, decision: 'approve' | 'reject') => {
    setResolvingTaskId(taskId);
    try {
      await onResolveHitlTask(taskId, decision);
    } finally {
      setResolvingTaskId(null);
    }
  };

  const pendingCount = tasks.filter((t) => t.status === 'pending_human_approval').length;
  const approvedCount = tasks.filter((t) => t.status === 'approved_live').length;

  return (
    <div className="space-y-8">
      {/* Header & Track Architecture Summary */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#F4F0EA]/10 pb-6">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-[#D4AF37]">
            Saint AI Agent Bounty · Autonomous Back-Office &amp; Event Ingestion
          </p>
          <h2 className="mt-1 font-display text-3xl sm:text-4xl text-[#F4F0EA] tracking-tight">
            Autonomous Workflow Engine &amp; Human-in-the-Loop Gate
          </h2>
          <p className="mt-2 text-sm text-[#A39E93] max-w-3xl leading-relaxed">
            Replaces manual 10-tab spreadsheet event curation and interval logistics. Saint AI reads event URLs,
            geocodes venues against OpenStreetMap &amp;{' '}
            <span className="font-mono text-[#F4F0EA]">martinhe.co.uk/tube/</span>, computes nearest London Datastore
            #OneLess water fountains &amp; public toilets, generates{' '}
            <span className="font-mono text-[#F4F0EA]">voyage-3</span> semantic embeddings, and pauses at a 1-click
            Human-in-the-Loop confirmation card before publishing to the live map or charging for interval pre-orders.
          </p>
        </div>

        <div className="flex items-center gap-6 text-xs font-mono text-[#A39E93] shrink-0">
          <div>
            <span className="text-[#6E6A61] block">AWAITING APPROVAL</span>
            <span className="text-lg text-[#D97706] font-semibold tabular-nums">{pendingCount}</span>
          </div>
          <span className="text-[#F4F0EA]/15">·</span>
          <div>
            <span className="text-[#6E6A61] block">COMMITTED TO MAP</span>
            <span className="text-lg text-[#2E8B57] font-semibold tabular-nums">{approvedCount}</span>
          </div>
          <span className="text-[#F4F0EA]/15">·</span>
          <div>
            <span className="text-[#6E6A61] block">LIVE CIVIC EVENTS</span>
            <span className="text-lg text-[#F4F0EA] font-semibold tabular-nums">
              {liveEvents.length}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Zero-Friction URL Ingestion Form */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Link2 className="w-4 h-4 text-[#D4AF37]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F4F0EA]">
                  Zero-Friction URL Event Ingestion
                </h3>
              </div>
              <ArgonTag>Argon · tool-loop</ArgonTag>
            </div>

            <p className="text-xs text-[#A39E93] leading-relaxed">
              Paste a Luma, Bandsintown, Eventbrite, Royal Ballet &amp; Opera, or West End URL. The agent autonomously
              extracts structured metadata, verifies duplicates against{' '}
              <span className="font-mono text-[#F4F0EA]">live_events</span>, computes OpenStreetMap &amp; London
              Datastore civic node distances, and stages a diff for human review.
            </p>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#6E6A61]">
                Quick Demo Event URLs
              </span>
              <div className="flex flex-col gap-1.5">
                {SAMPLE_INGEST_PRESETS.map((preset) => (
                  <button
                    key={preset.url}
                    type="button"
                    onClick={() => {
                      setUrlInput(preset.url);
                      setUrlError(null);
                    }}
                    className="text-left px-3 py-2 rounded-lg bg-[#1B1E28]/70 hover:bg-[#1B1E28] border border-[#F4F0EA]/8 text-xs text-[#F4F0EA] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span className="truncate pr-2">{preset.label}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSubmitIngestion} className="space-y-4">
              <div>
                <label
                  htmlFor="saint-url-input"
                  className="block text-xs font-mono uppercase tracking-wider text-[#A39E93] mb-1.5"
                >
                  Target Event URL
                </label>
                <input
                  id="saint-url-input"
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://lu.ma/... or https://www.bandsintown.com/..."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0C10] border border-[#F4F0EA]/15 text-xs font-mono text-[#F4F0EA] focus:outline-none focus:border-[#D4AF37]"
                />
                {urlError && (
                  <p className="mt-1.5 text-xs text-[#DC2626] flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {urlError}
                  </p>
                )}
              </div>

              <ArgonButton type="submit" label="Run Argon ingestion agent" busyLabel="Argon agent running…" busy={isIngesting} className="w-full justify-center py-2.5" />
            </form>
          </div>

          {/* Agent Guardrails & Safety Architecture Card */}
          <div className="bg-[#13151C] border border-[#F4F0EA]/10 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4AF37]">
              <ShieldAlert className="w-4 h-4" />
              <span>Safety, Permissions &amp; Audit Trail</span>
            </div>
            <div className="space-y-2 text-xs text-[#A39E93] leading-relaxed">
              <p>
                <strong className="text-[#F4F0EA]">Read-Only Autonomous Phase:</strong> Reading URL metadata, querying
                Open-Meteo rain radar, computing OpenStreetMap walking distances, and checking duplicate records run
                automatically with retry recovery.
              </p>
              <p>
                <strong className="text-[#F4F0EA]">Mandatory Human Gate:</strong> Writing public events to the shared{' '}
                <span className="font-mono text-[#F4F0EA]">martinhe.co.uk/tube/</span> map or committing interval bar
                pre-orders strictly halts in{' '}
                <span className="font-mono text-[#D97706]">pending_human_approval</span> state until explicitly
                confirmed.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: HITL Approval Queue & Execution Audit Log */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[#F4F0EA]">
              Human-in-the-Loop Confirmation Queue &amp; Execution Audit Log
            </h3>
            <span className="text-xs font-mono text-[#A39E93]">
              {tasks.length} total agent runs recorded
            </span>
          </div>

          <div className="space-y-5">
            {tasks.map((task) => {
              const isPending = task.status === 'pending_human_approval';
              const isApproved = task.status === 'approved_live';

              return (
                <div
                  key={task.task_id}
                  className={`rounded-xl border p-6 transition-all space-y-5 ${
                    isPending
                      ? 'bg-[#13151C] border-[#D4AF37]/45 shadow-[0_12px_32px_rgba(0,0,0,0.5)]'
                      : 'bg-[#13151C]/75 border-[#F4F0EA]/10'
                  }`}
                >
                  {/* Top metadata line */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F4F0EA]/8 pb-3.5">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      {task.workflow_type === 'url_event_ingestion' ? (
                        <FileCheck2 className="w-4 h-4 text-[#D4AF37]" />
                      ) : (
                        <Coffee className="w-4 h-4 text-[#D4AF37]" />
                      )}
                      <span className="text-[#F4F0EA] font-semibold uppercase">
                        {task.workflow_type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[#6E6A61]">·</span>
                      <span className="text-[#A39E93]">{task.task_id}</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono">
                      {isPending && (
                        <span className="text-[#D97706] flex items-center gap-1.5 font-semibold">
                          <Clock className="w-3.5 h-3.5" />
                          AWAITING HUMAN APPROVAL
                        </span>
                      )}
                      {isApproved && (
                        <span className="text-[#2E8B57] flex items-center gap-1.5 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          APPROVED &amp; LIVE ON MAP
                        </span>
                      )}
                      {task.status === 'rejected' && (
                        <span className="text-[#DC2626] flex items-center gap-1.5 font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          REJECTED BY OPERATOR
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Action Summary */}
                  <div>
                    <h4 className="font-display text-2xl text-[#F4F0EA]">{task.summary_title}</h4>
                    <p className="mt-1 text-xs text-[#A39E93] leading-relaxed">
                      {task.proposed_action_label}
                    </p>
                    {task.source_url && (
                      <p className="mt-1.5 text-[11px] font-mono text-[#D4AF37] truncate">
                        Source URL: {task.source_url}
                      </p>
                    )}
                  </div>

                  {/* Multi-Step Tool Execution Trace */}
                  <div className="bg-[#0B0C10] border border-[#F4F0EA]/8 rounded-lg p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-[#6E6A61]">
                      <span>Autonomous Tool Execution Trace</span>
                      <span>{task.agent_steps_log.length} steps</span>
                    </div>
                    <div className="space-y-1.5">
                      {task.agent_steps_log.map((stepText, idx) => (
                        <div
                          key={idx}
                          className="text-xs text-[#A39E93] font-mono border-t border-[#F4F0EA]/6 pt-1.5 first:border-t-0 first:pt-0"
                        >
                          {stepText}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Structured Diff Table before write */}
                  <div className="space-y-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-[#6E6A61]">
                      Proposed State Mutation Diff (Before vs After)
                    </span>
                    <div className="overflow-x-auto rounded-lg border border-[#F4F0EA]/10">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#1B1E28] text-[#A39E93] font-mono text-[11px]">
                            <th className="py-2 px-3">Field</th>
                            <th className="py-2 px-3">Before</th>
                            <th className="py-2 px-3">Proposed Agent Value</th>
                            <th className="py-2 px-3 text-right">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F4F0EA]/8 bg-[#0B0C10]">
                          {task.diff_fields.map((row, idx) => (
                            <tr key={idx}>
                              <td className="py-2 px-3 font-mono text-[#F4F0EA]">{row.field}</td>
                              <td className="py-2 px-3 font-mono text-[#6E6A61]">{row.before}</td>
                              <td className="py-2 px-3 font-mono text-[#2E8B57]">{row.after}</td>
                              <td className="py-2 px-3 font-mono text-right text-[#D4AF37] tabular-nums">
                                {row.confidence}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Linked Civic Nodes & WhatsApp/Concierge Preview */}
                  <div className="bg-[#1B1E28]/60 border border-[#D4AF37]/30 rounded-lg p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between font-mono text-[#D4AF37]">
                      <span className="flex items-center gap-1.5">
                        <Navigation className="w-3.5 h-3.5" />
                        LINKED OPEN LONDON CIVIC LAYER
                      </span>
                      <span>2dsphere Verified</span>
                    </div>
                    <p className="text-[#A39E93]">
                      <strong className="text-[#F4F0EA]">Pedestrian Route:</strong>{' '}
                      {task.linked_civic_nodes.walk_route}
                    </p>
                    <p className="text-[#A39E93]">
                      <strong className="text-[#F4F0EA]">Hydration &amp; WC:</strong>{' '}
                      {task.linked_civic_nodes.water_fountain} · {task.linked_civic_nodes.toilet}
                    </p>
                    <p className="text-[#A39E93]">
                      <strong className="text-[#F4F0EA]">Weather / Air / Flood:</strong>{' '}
                      {task.linked_civic_nodes.weather_air_flood}
                    </p>
                    {task.whatsapp_group_preview && (
                      <p className="pt-1 text-[#F4F0EA] font-mono text-[11px] border-t border-[#F4F0EA]/10">
                        {task.whatsapp_group_preview}
                      </p>
                    )}
                  </div>

                  {/* Impact & 1-Click Human-in-the-Loop Action Bar */}
                  <div className="pt-2 border-t border-[#F4F0EA]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="text-xs text-[#A39E93]">
                      <span className="font-mono uppercase text-[11px] text-[#D97706] block">
                        Financial / Public Map Impact Requiring Approval:
                      </span>
                      {task.financial_or_public_impact}
                    </div>

                    {isPending && (
                      <div className="flex items-center gap-2.5 shrink-0">
                        <button
                          type="button"
                          disabled={resolvingTaskId === task.task_id}
                          onClick={() => handleResolve(task.task_id, 'reject')}
                          className="px-3.5 py-2 rounded-lg border border-[#DC2626]/50 text-[#DC2626] hover:bg-[#DC2626]/10 text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={resolvingTaskId === task.task_id}
                          onClick={() => handleResolve(task.task_id, 'approve')}
                          className="px-4 py-2 rounded-lg bg-[#2E8B57] hover:bg-[#359e63] text-[#F4F0EA] text-xs font-mono font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {resolvingTaskId === task.task_id
                            ? 'Committing...'
                            : 'Approve & Publish (1-Click HITL)'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
