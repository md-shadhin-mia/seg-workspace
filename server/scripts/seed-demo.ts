/**
 * Fills a database with a realistic demo company: four teams, fifteen people and four months of task
 * history (assignments, deadlines, submissions and reviews), so dashboards and analytics have something
 * to show. Local development only: it refuses to run unless the database name contains "demo".
 *
 *   DATABASE_URL=postgres://seg:seg@localhost:5432/seg_demo npm run seed:demo -w server
 *
 * Everyone signs in with DEMO_PASSWORD (default below); the admin is admin@demo.test.
 */
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword } from '../src/lib/crypto.js';
import { deriveStatus } from '../src/lib/access.js';
import type { Status } from '../src/lib/types.js';

const cfg = loadConfig();
if (!/demo/i.test(new URL(cfg.DATABASE_URL).pathname)) {
  console.error('Refusing to seed: DATABASE_URL must point at a database whose name contains "demo".');
  process.exit(1);
}
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-123';
const sql = createDb(cfg.DATABASE_URL, 2, cfg.APP_TIMEZONE);

// Deterministic randomness, so every seed looks the same.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date(); today.setUTCHours(0, 0, 0, 0);
const day = (offset: number) => iso(new Date(today.getTime() + offset * 864e5));
const at = (date: string, h = int(9, 18)) => `${date} ${String(h).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00`;

const TEAMS = [
  { name: 'Development', department: 'Technology', lead: ['Nadia Karim', 'Engineering Lead'], members: [['Tanvir Ahmed', 'Frontend Developer', 0.92], ['Imran Kabir', 'Backend Developer', 0.78], ['Arif Hossain', 'Full-stack Developer', 0.64]],
    projects: [['Main Website', 'Rebuild of the public website and course pages.'], ['Student Portal', 'Applications, documents and offer letters in one place.']],
    work: ['Build the course finder', 'Fix enquiry form validation', 'Add country filter to listings', 'Speed up the homepage', 'Set up staging deploys', 'Write API docs for partners', 'Migrate image hosting', 'Accessibility pass on forms', 'Add document upload limits', 'Offer letter PDF template', 'Payment receipt emails', 'Sign-in rate limiting', 'Search results paging', 'Mobile menu polish'] },
  { name: 'Digital Marketing', department: 'Growth', lead: ['Mamun Rahman', 'Marketing Lead'], members: [['Walid Hasan', 'Graphic Designer', 0.85], ['Sabbir Hossain', 'Content Writer', 0.7], ['Nusrat Jahan', 'Social Media Executive', 0.88]],
    projects: [['Malaysia Study Fair', 'Event campaign for the Kuala Lumpur fair.'], ['Spring Intake Campaign', 'Paid and organic push for the spring intake.']],
    work: ['Campaign banner set', 'Facebook ad copy', 'Landing page headline tests', 'Weekly newsletter', 'Instagram reel script', 'Student testimonial video', 'Event booth artwork', 'Retargeting audience setup', 'Blog: studying in Malaysia', 'Email drip for enquiries', 'Poster for campus visits', 'Monthly performance report'] },
  { name: 'Design', department: 'Technology', lead: ['Sadia Islam', 'Design Lead'], members: [['Tania Akter', 'Product Designer', 0.9], ['Faisal Ahmed', 'UI Designer', 0.6]],
    projects: [['Brand Refresh', 'New logo usage, colours and templates.']],
    work: ['Colour palette proposal', 'Icon set refresh', 'Brochure template', 'Presentation template', 'Logo usage guide', 'Website hero illustrations', 'Email header designs', 'Business card update'] },
  { name: 'Admissions', department: 'Operations', lead: ['Rafiq Hasan', 'Admissions Manager'], members: [['Rumana Begum', 'Admissions Officer', 0.82], ['Jamal Uddin', 'Counsellor', 0.72]],
    projects: [['Q1 Intake Processing', 'Applications and visas for the January intake.']],
    work: ['Review pending applications', 'Call shortlisted students', 'Prepare visa document checklist', 'Update university requirements sheet', 'Interview scheduling', 'Offer letter follow-ups', 'Scholarship shortlist', 'Pre-departure briefing'] },
] as const;

async function main() {
  await sql.unsafe('drop schema public cascade; create schema public;');
  await migrate(sql);
  const pw = await hashPassword(PASSWORD);
  const [admin] = await sql`insert into users (email, name, title, password_hash, role, status, approved_at, created_at)
    values ('admin@demo.test', 'Farhana Chowdhury', 'Operations Director', ${pw}, 'admin', 'active', now(), now() - interval '200 days') returning id`;
  const email = (n: string) => `${n.toLowerCase().split(' ')[0]}@demo.test`;
  let tasks = 0;

  for (const T of TEAMS) {
    const [team] = await sql`insert into teams (name, description, department) values (${T.name}, '', ${T.department})
      on conflict (lower(name)) do update set department = excluded.department returning id`;
    const mk = async (name: string, title: string, role: 'lead' | 'member') => {
      const [u] = await sql`insert into users (email, name, title, password_hash, role, status, approved_at, created_at)
        values (${email(name)}, ${name}, ${title}, ${pw}, 'member', 'active', now(), now() - interval '180 days') returning id`;
      await sql`insert into team_members (team_id, user_id, role) values (${team.id}, ${u.id}, ${role})`;
      return u.id as string;
    };
    const leadId = await mk(T.lead[0], T.lead[1], 'lead');
    const members = [] as { id: string; skill: number }[];
    for (const [n, t, skill] of T.members) members.push({ id: await mk(n, t, 'member'), skill });
    const people = [...members, { id: leadId, skill: 0.85 }];

    for (const [pi, [pname, pdesc]] of T.projects.entries()) {
      const [project] = await sql`insert into projects (team_id, name, description, status, due_date, lead_id, created_by, created_at)
        values (${team.id}, ${pname}, ${pdesc}, ${pick(['on_track', 'on_track', 'at_risk'])}, ${day(int(20, 75))}, ${leadId}, ${leadId}, now() - interval '130 days') returning id`;
      const count = int(16, 26) - pi * 3;
      for (let i = 0; i < count; i++) {
        const created = -int(0, 118);
        const due = created + int(4, 24);
        const who = rnd() < 0.25 && members.length > 1 ? [pick(members), pick(members)].filter((x, k, a) => a.indexOf(x) === k) : [rnd() < 0.12 ? people.at(-1)! : pick(members)];
        const title = `${pick([...T.work])}${rnd() < 0.4 ? ` (${pick(['v2', 'phase 2', 'follow-up', 'Malaysia', 'UK', 'Canada'])})` : ''}`;
        const priority = pick(['low', 'medium', 'medium', 'high', 'urgent']);
        const [task] = await sql`insert into tasks (project_id, title, description, priority, due_date, reviewer_id, created_by, created_at, updated_at)
          values (${project.id}, ${title}, '', ${priority}, ${day(due)}, ${leadId}, ${leadId}, ${at(day(created))}, ${at(day(created))}) returning id`;
        tasks++;
        const statuses: Status[] = [];
        let lastDone: string | null = null;
        for (const p of who) {
          const assigned = created + int(0, 2);
          let status: Status;
          let doneOn: number | null = null;
          const dueIsPast = due < 0;
          if (dueIsPast ? rnd() < 0.55 + p.skill * 0.42 : rnd() < 0.25 * p.skill) {
            status = 'done';
            // Strong performers mostly finish before the due date; others drift late.
            doneOn = Math.min(0, Math.max(assigned + 1, due + (rnd() < p.skill ? -int(0, 4) : int(1, 7))));
          } else {
            status = dueIsPast ? pick(['in_progress', 'changes', 'review', 'in_progress']) : pick(['todo', 'todo', 'in_progress', 'in_progress', 'review']);
          }
          statuses.push(status);
          const updated = doneOn !== null ? at(day(doneOn)) : at(day(Math.min(0, assigned + int(0, 5))));
          await sql`insert into task_assignees (task_id, user_id, status, assigned_by, assigned_at, updated_at)
            values (${task.id}, ${p.id}, ${status}, ${leadId}, ${at(day(assigned), 9)}, ${updated})`;
          await sql`insert into activity (task_id, actor_id, action, meta, created_at) values (${task.id}, ${leadId}, 'assigned', ${sql.json({ userIds: [p.id] })}, ${at(day(assigned), 9)})`;
          // Submissions and reviews: weaker performers more often get changes requested first.
          if (status === 'done' || status === 'review' || status === 'changes') {
            const sentBack = rnd() > p.skill;
            const subDay = doneOn !== null ? doneOn - (sentBack ? 2 : 0) : Math.min(0, assigned + int(1, 6));
            let v = 1;
            if (sentBack || status === 'changes') {
              await sql`insert into submissions (task_id, user_id, version, note, state, feedback, reviewed_by, reviewed_at, created_at)
                values (${task.id}, ${p.id}, ${v}, '', 'changes', 'Please tighten this up and resubmit.', ${leadId}, ${at(day(Math.min(0, subDay + 1)))}, ${at(day(subDay))})`;
              await sql`insert into activity (task_id, actor_id, action, meta, created_at) values (${task.id}, ${leadId}, 'changes_requested', ${sql.json({ userId: p.id, version: v })}, ${at(day(Math.min(0, subDay + 1)))})`;
              v++;
            }
            if (status === 'done') {
              await sql`insert into submissions (task_id, user_id, version, note, state, reviewed_by, reviewed_at, created_at)
                values (${task.id}, ${p.id}, ${v}, '', 'approved', ${leadId}, ${updated}, ${at(day(doneOn!))})`;
              await sql`insert into activity (task_id, actor_id, action, meta, created_at) values (${task.id}, ${leadId}, 'approved', ${sql.json({ userId: p.id, version: v })}, ${updated})`;
              if (!lastDone || day(doneOn!) > lastDone) lastDone = day(doneOn!);
            } else if (status === 'review') {
              await sql`insert into submissions (task_id, user_id, version, note, state, created_at) values (${task.id}, ${p.id}, ${v}, '', 'pending', ${updated})`;
              await sql`insert into activity (task_id, actor_id, action, meta, created_at) values (${task.id}, ${p.id}, 'submitted', ${sql.json({ version: v })}, ${updated})`;
            }
          } else if (status === 'in_progress') {
            await sql`insert into activity (task_id, actor_id, action, meta, created_at) values (${task.id}, ${p.id}, 'status', ${sql.json({ userId: p.id, from: 'todo', to: 'in_progress' })}, ${updated})`;
          }
        }
        const overall = deriveStatus(statuses, 'todo');
        await sql`update tasks set status = ${overall}, completed_at = ${overall === 'done' ? at(lastDone!) : null} where id = ${task.id}`;
      }
    }
  }
  console.log(`Seeded ${TEAMS.length} teams, ${tasks} tasks. Admin: admin@demo.test (${admin.id}).`);
  await sql.end();
}

await main();
