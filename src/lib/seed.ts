import 'server-only';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * Seed the database on first run only (when there are no users).
 * Data mirrors the DLOM Group 2026 Project Dashboard starter workbook.
 */
export async function ensureSeed(pool: Pool) {
  const { rows } = await pool.query('SELECT COUNT(*) AS n FROM users');
  if ((rows[0].n as number) > 0) return;

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));
  const isoTime = (d: Date) => d.toISOString();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertUser = async (name: string, email: string, pw: string, role: string) =>
      (
        await client.query(
          'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id',
          [name, email, hash(pw), role]
        )
      ).rows[0].id as number;

    // ---- Users ------------------------------------------------------------
    const adminId = await insertUser('Will Deaton', 'wdeaton@dlomgroup.com', 'cornerstone2026', 'admin');
    const mikeId = await insertUser('Mike Johnson', 'mike@dlomgroup.com', 'welcome123', 'worker');
    const daveId = await insertUser('Dave Smith', 'dave@dlomgroup.com', 'welcome123', 'worker');

    // ---- Open quotes (pipeline) — matches "Pipeline by Customer/Category" -
    const weekOf = daysAgo(3);
    const quotes = [
      ['Q-2601', 'ARH-Highlands', 'Highlands ARH – Corridor Flooring Replacement', 'Flooring', 187221],
      ['Q-2602', 'Carl D. Perkins', 'Carl D. Perkins Center – Gym Floor Refinish', 'Flooring', 125274],
      ['Q-2603', 'Georgetown CH', 'Georgetown Community Hospital – Interior Repaint', 'Painting', 107531],
      ['Q-2604', 'Corbin MOB', 'Corbin Medical Office Bldg – Restroom Renovation', 'Renovation', 82236],
      ['Q-2605', 'CPS Proposals', 'CPS – District Facility Maintenance', 'Maintenance', 61827],
      ['Q-2606', 'ARH-Hazard', 'Hazard ARH – Roof Restoration', 'Roofing', 34561],
      ['Q-2607', 'Brandi Simon Law Office', 'Brandi Simon Law – Office Buildout', 'Renovation', 29239],
      ['Q-2608', 'Bluegrass CH', 'Bluegrass Community Hospital – Common Area Flooring', 'Flooring', 22259],
      ['Q-2609', 'Heritage Pool Supply', 'Heritage Pool Supply – Showroom Refresh', 'Painting', 13869],
      ['Q-2610', 'ARH-Tug Valley', 'Tug Valley ARH – Exterior Pressure Wash & Seal', 'Restoration', 13216],
    ] as const;
    for (let i = 0; i < quotes.length; i++) {
      const [quote_number, customer, project_name, category, bid_value] = quotes[i];
      await client.query(
        `INSERT INTO quotes (quote_number, customer, project_name, category, bid_value, status, date_received, week_of, source)
         VALUES ($1,$2,$3,$4,$5,'open',$6,$7,'seed')`,
        [quote_number, customer, project_name, category, bid_value, daysAgo(2 + (i % 6)), weekOf]
      );
    }

    // ---- Recently decided quotes (for "Lost / Sold in the last 2 weeks") ---
    const decided: [string, string, string, string, number, string, number][] = [
      ['Q-2590', 'Pikeville Med', 'Pikeville Medical – Lobby Flooring', 'Flooring', 54800, 'sold', 3],
      ['Q-2588', 'Whitesburg ARH', 'Whitesburg ARH – Break Room Refresh', 'Painting', 18400, 'sold', 6],
      ['Q-2585', 'Rockcastle Reg', 'Rockcastle Regional – Parking Lot Seal', 'Restoration', 26100, 'lost', 4],
      ['Q-2581', 'Baptist Health', 'Baptist Health – Stairwell Repaint', 'Painting', 12750, 'lost', 9],
    ];
    for (const [quote_number, customer, project_name, category, bid_value, status, days] of decided) {
      await client.query(
        `INSERT INTO quotes (quote_number, customer, project_name, category, bid_value, status, date_received, week_of, source, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'seed', now() - ($9 || ' days')::interval)`,
        [quote_number, customer, project_name, category, bid_value, status, daysAgo(days + 7), daysAgo(days + 7), String(days)]
      );
    }

    // ---- Sold / in-progress work — matches "Sold / In-Progress by Status" -
    const projects = [
      { quote_number: 'Q-2510', customer: 'ARH-Highlands', name: 'Highlands ARH – Phase 1 Flooring', category: 'Flooring', value: 98500, status: 'completed', progress: 100, location: 'Prestonsburg, KY', start_date: daysAgo(120), end_date: daysAgo(38), due_date: daysAgo(40) },
      { quote_number: 'Q-2512', customer: 'Georgetown CH', name: 'Georgetown CH – East Wing Repaint', category: 'Painting', value: 72016, status: 'completed', progress: 100, location: 'Georgetown, KY', start_date: daysAgo(95), end_date: daysAgo(28), due_date: daysAgo(30) },
      { quote_number: 'Q-2515', customer: 'Heritage Pool Supply', name: 'Heritage Pool – Showroom Refresh', category: 'Painting', value: 44500, status: 'completed', progress: 100, location: 'Lexington, KY', start_date: daysAgo(70), end_date: daysAgo(19), due_date: daysAgo(20) },
      { quote_number: 'Q-2540', customer: 'Corbin MOB', name: 'Corbin MOB – Restroom Renovation', category: 'Renovation', value: 38105, status: 'in_progress', progress: 60, location: 'Corbin, KY', start_date: daysAgo(25), end_date: null, due_date: daysAgo(-15) },
      { quote_number: 'Q-2545', customer: 'Bluegrass CH', name: 'Bluegrass CH – Common Area Flooring', category: 'Flooring', value: 19000, status: 'in_progress', progress: 35, location: 'Versailles, KY', start_date: daysAgo(12), end_date: null, due_date: daysAgo(-22) },
      { quote_number: 'Q-2560', customer: 'Carl D. Perkins', name: 'Carl D. Perkins – Gymnasium Refinish', category: 'Flooring', value: 45750, status: 'not_started', progress: 0, location: 'Edmonton, KY', start_date: daysAgo(-10), end_date: null, due_date: daysAgo(-45) },
      { quote_number: 'Q-2562', customer: 'Brandi Simon Law Office', name: 'Brandi Simon Law – Office Buildout', category: 'Renovation', value: 25000, status: 'not_started', progress: 0, location: 'Nicholasville, KY', start_date: daysAgo(-7), end_date: null, due_date: daysAgo(-38) },
    ] as const;

    const projectIds: Record<string, number> = {};
    for (const p of projects) {
      const id = (
        await client.query(
          `INSERT INTO projects (quote_number, customer, name, category, value, status, progress, location, start_date, end_date, due_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [p.quote_number, p.customer, p.name, p.category, p.value, p.status, p.progress, p.location, p.start_date, p.end_date, p.due_date]
        )
      ).rows[0].id as number;
      projectIds[p.name] = id;
    }

    // ---- A few notes + time entries so the detail views aren't empty ------
    const corbin = projectIds['Corbin MOB – Restroom Renovation'];
    const bluegrass = projectIds['Bluegrass CH – Common Area Flooring'];

    const insertNote = (pid: number, uid: number, author: string, body: string, at: string) =>
      client.query(
        'INSERT INTO notes (project_id, user_id, author_name, body, created_at) VALUES ($1,$2,$3,$4,$5)',
        [pid, uid, author, body, at]
      );
    await insertNote(corbin, adminId, 'Will Deaton', 'Demo delayed one day — waiting on tile delivery from supplier.', isoTime(new Date(Date.now() - 4 * 864e5)));
    await insertNote(corbin, mikeId, 'Mike Johnson', 'Framing and plumbing rough-in complete. Starting tile Thursday.', isoTime(new Date(Date.now() - 2 * 864e5)));
    await insertNote(bluegrass, daveId, 'Dave Smith', 'Furniture moved and subfloor prepped in the east lobby.', isoTime(new Date(Date.now() - 1 * 864e5)));

    const insertTime = (pid: number, uid: number, cin: string, cout: string, note: string) =>
      client.query(
        'INSERT INTO time_entries (project_id, user_id, clock_in, clock_out, note) VALUES ($1,$2,$3,$4,$5)',
        [pid, uid, cin, cout, note]
      );
    await insertTime(corbin, mikeId, isoTime(new Date(Date.now() - 2 * 864e5 - 8 * 36e5)), isoTime(new Date(Date.now() - 2 * 864e5)), 'Rough-in');
    await insertTime(corbin, daveId, isoTime(new Date(Date.now() - 1 * 864e5 - 7 * 36e5)), isoTime(new Date(Date.now() - 1 * 864e5)), 'Demo & haul-off');
    await insertTime(bluegrass, daveId, isoTime(new Date(Date.now() - 1 * 864e5 - 6 * 36e5)), isoTime(new Date(Date.now() - 1 * 864e5)), 'Subfloor prep');

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
