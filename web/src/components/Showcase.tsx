import { useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarDays, ChartNoAxesCombined, Check, ClipboardCheck, FolderKanban, Gauge, ListChecks, Pause, Play, Trophy, UsersRound } from 'lucide-react';
import { Avatar, StatusPill } from './ui';
import { Ring, Sparkline } from './charts';

/* The sign-in page's product tour: illustrative cards of what the workspace shows, drifting upwards in
   two columns at different speeds. Purely decorative (hidden from screen readers), paused on hover or
   with the button, and still when the person prefers reduced motion. */

function Card({ icon, title, meta, children, fd }: { icon: ReactNode; title: string; meta?: string; children: ReactNode; fd?: string }) {
  return (
    <div className="sc" style={{ '--fd': fd } as CSSProperties}>
      <div className="sc-h"><span className="kpi-ic" style={{ width: 28, height: 28, borderRadius: 9, background: 'var(--muted)' }}>{icon}</span><span className="grow">{title}</span>{meta && <small>{meta}</small>}</div>
      {children}
    </div>
  );
}

const TEAM = [['Development', 86, 'var(--green-solid)'], ['Digital Marketing', 74, 'var(--blue-solid)'], ['Design', 68, 'var(--violet-solid)']] as const;

const colA = [
  <Card key="team" icon={<Trophy size={15} />} title="Team performance" meta="Last 30 days">
    <div className="gauge">
      <Ring value={82} size={86} stroke={10} color="var(--green-solid)"><b className="num">82</b><small>KPI score</small></Ring>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TEAM.map(([n, v, c]) => (
          <div key={n} style={{ fontSize: 11.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-2)' }}><span>{n}</span><b>{v}</b></div>
            <div className="progress" style={{ height: 5, marginTop: 3 }}><i style={{ width: `${v}%`, background: c }} /></div>
          </div>
        ))}
      </div>
    </div>
  </Card>,
  <Card key="tasks" icon={<ListChecks size={15} />} title="Today's tasks" meta="4 open" fd="-2s">
    <div className="tasks">
      {([['Homepage hero copy', 'done'], ['Malaysia campaign banner', 'review'], ['Enquiry form validation', 'in_progress'], ['Agent onboarding deck', 'todo']] as const).map(([t, s]) => (
        <div className="task" key={t}><span className={`chk ${s === 'done' ? 'on' : ''}`}>{s === 'done' && <Check size={11} />}</span><span className="grow">{t}</span><StatusPill status={s} /></div>
      ))}
    </div>
  </Card>,
  <Card key="trend" icon={<ChartNoAxesCombined size={15} />} title="Productivity trend" meta="Completed / week" fd="-4s">
    <div className="tint" style={{ background: 'var(--tint-blue)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="big">148</span><span className="delta up">+12%</span></div>
      <Sparkline data={[18, 22, 19, 27, 25, 31, 29, 36]} color="var(--blue)" height={54} />
    </div>
  </Card>,
  <Card key="cal" icon={<CalendarDays size={15} />} title="Deadlines" meta="May 2026" fd="-1s">
    <div className="cal-mini">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      {Array.from({ length: 21 }, (_, i) => i + 4).map((d) => (
        <span key={d} className={d === 15 ? 't' : [9, 12].includes(d) ? 'o' : [17, 18, 22].includes(d) ? 'd' : ''}>{d}</span>
      ))}
    </div>
  </Card>,
];

const colB = [
  <Card key="kpi" icon={<Gauge size={15} />} title="Employee KPI" fd="-3s">
    <div className="person"><Avatar name="Nadia Karim" size={34} /><div className="grow"><b>Nadia Karim</b><small>Frontend Developer</small></div><span className="score green">91</span></div>
    <div className="row2">
      <div><b>94%</b>On time</div>
      <div><b>88%</b>Completion</div>
      <div><b>12</b>Done</div>
    </div>
  </Card>,
  <Card key="proj" icon={<FolderKanban size={15} />} title="Spring Admissions" meta="Due Jun 30" fd="-5s">
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="big">68%</span><small className="muted">complete</small></div>
    <div className="stackbar" style={{ height: 10 }}>
      <div className="grow-x" style={{ width: '100%' }}>
        <i style={{ flexGrow: 17, background: 'var(--green-solid)' }} /><i style={{ flexGrow: 4, background: 'var(--violet-solid)' }} /><i style={{ flexGrow: 3, background: 'var(--blue-solid)' }} /><i style={{ flexGrow: 1, background: 'var(--red-solid)' }} />
      </div>
    </div>
    <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--fg-3)' }}><span>17 done</span><span>4 in review</span><span>3 active</span><span style={{ color: 'var(--red)' }}>1 overdue</span></div>
  </Card>,
  <Card key="load" icon={<UsersRound size={15} />} title="Team workload" fd="-2.5s">
    {([['Tanvir Ahmed', [3, 2, 1]], ['Imran Kabir', [2, 4, 0]], ['Walid Hasan', [1, 1, 2]]] as const).map(([n, v]) => (
      <div className="person" key={n}>
        <Avatar name={n} size={24} /><span style={{ width: 86, fontSize: 12 }}>{n.split(' ')[0]}</span>
        <div className="stackbar" style={{ height: 8, flex: 1 }}>
          <div className="grow-x" style={{ width: `${(v[0] + v[1] + v[2]) * 14}%` }}>
            <i style={{ flexGrow: v[0], background: 'var(--blue-solid)' }} /><i style={{ flexGrow: v[1], background: 'var(--violet-solid)' }} />{v[2] > 0 && <i style={{ flexGrow: v[2], background: 'var(--red-solid)' }} />}
          </div>
        </div>
      </div>
    ))}
  </Card>,
  <Card key="review" icon={<ClipboardCheck size={15} />} title="Waiting for review" meta="2 versions" fd="-6s">
    <div className="tasks">
      <div className="task" style={{ background: 'var(--violet-bg)' }}><Avatar name="Imran Kabir" size={22} /><span className="grow">Campaign banner · V2</span><small className="muted">5m ago</small></div>
      <div className="task" style={{ background: 'var(--violet-bg)' }}><Avatar name="Tanvir Ahmed" size={22} /><span className="grow">Course finder page · V1</span><small className="muted">1h ago</small></div>
    </div>
  </Card>,
];

export function Showcase() {
  const [paused, setPaused] = useState(false);
  return (
    <aside className="auth-side">
      <div className="show-cap" aria-hidden="true">
        <span className="eyebrow"><i />SEG Workspace</span>
        <h2>Plan the work, track every person's progress, and <mark>see how the team is really doing.</mark></h2>
      </div>
      <div className={`showcase ${paused ? 'paused' : ''}`} aria-hidden="true">
        {[[colA, '56s'], [colB, '70s']].map(([cards, dur], i) => (
          <div className="show-col" key={i}>
            {/* Two copies, so moving up by half loops seamlessly. */}
            <div className="show-track" style={{ '--dur': dur } as CSSProperties}>{cards}{cards}</div>
          </div>
        ))}
      </div>
      <div className="show-pause">
        <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the product preview' : 'Pause the product preview'} title={paused ? 'Play' : 'Pause'}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
    </aside>
  );
}
