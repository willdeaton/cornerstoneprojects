import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

/**
 * Seed the database on first run only (when there are no users).
 * Data mirrors the DLOM Group 2026 Project Dashboard starter workbook.
 */
export function ensureSeed(db: Database.Database) {
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (userCount > 0) return;

  const hash = (p: string) => bcrypt.hashSync(p, 10);

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );
  const insertQuote = db.prepare(
    `INSERT INTO quotes (customer, project_name, category, bid_value, status, date_received, week_of, source)
     VALUES (@customer, @project_name, @category, @bid_value, @status, @date_received, @week_of, 'seed')`
  );
  const insertProject = db.prepare(
    `INSERT INTO projects (customer, name, category, value, status, progress, location, start_date, due_date)
     VALUES (@customer, @name, @category, @value, @status, @progress, @location, @start_date, @due_date)`
  );
  const insertNote = db.prepare(
    'INSERT INTO notes (project_id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertTime = db.prepare(
    'INSERT INTO time_entries (project_id, user_id, clock_in, clock_out, note) VALUES (?, ?, ?, ?, ?)'
  );

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 864e5));
  const isoTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

  const seed = db.transaction(() => {
    // ---- Users ------------------------------------------------------------
    const adminId = insertUser.run(
      'Will Deaton',
      'wdeaton@dlomgroup.com',
      hash('cornerstone2026'),
      'admin'
    ).lastInsertRowid as number;
    const mikeId = insertUser.run(
      'Mike Johnson',
      'mike@dlomgroup.com',
      hash('welcome123'),
      'worker'
    ).lastInsertRowid as number;
    const daveId = insertUser.run(
      'Dave Smith',
      'dave@dlomgroup.com',
      hash('welcome123'),
      'worker'
    ).lastInsertRowid as number;

    // ---- Open quotes (pipeline) — matches "Pipeline by Customer/Category" -
    const weekOf = daysAgo(3);
    const quotes = [
      ['ARH-Highlands', 'Highlands ARH – Corridor Flooring Replacement', 'Flooring', 187221],
      ['Carl D. Perkins', 'Carl D. Perkins Center – Gym Floor Refinish', 'Flooring', 125274],
      ['Georgetown CH', 'Georgetown Community Hospital – Interior Repaint', 'Painting', 107531],
      ['Corbin MOB', 'Corbin Medical Office Bldg – Restroom Renovation', 'Renovation', 82236],
      ['CPS Proposals', 'CPS – District Facility Maintenance', 'Maintenance', 61827],
      ['ARH-Hazard', 'Hazard ARH – Roof Restoration', 'Roofing', 34561],
      ['Brandi Simon Law Office', 'Brandi Simon Law – Office Buildout', 'Renovation', 29239],
      ['Bluegrass CH', 'Bluegrass Community Hospital – Common Area Flooring', 'Flooring', 22259],
      ['Heritage Pool Supply', 'Heritage Pool Supply – Showroom Refresh', 'Painting', 13869],
      ['ARH-Tug Valley', 'Tug Valley ARH – Exterior Pressure Wash & Seal', 'Restoration', 13216],
    ] as const;
    quotes.forEach(([customer, project_name, category, bid_value], i) => {
      insertQuote.run({
        customer,
        project_name,
        category,
        bid_value,
        status: 'open',
        date_received: daysAgo(2 + (i % 6)),
        week_of: weekOf,
      });
    });

    // ---- Sold / in-progress work — matches "Sold / In-Progress by Status" -
    const projects = [
      // Completed  ($215,016)
      { customer: 'ARH-Highlands', name: 'Highlands ARH – Phase 1 Flooring', category: 'Flooring', value: 98500, status: 'completed', progress: 100, location: 'Prestonsburg, KY', start_date: daysAgo(120), due_date: daysAgo(40) },
      { customer: 'Georgetown CH', name: 'Georgetown CH – East Wing Repaint', category: 'Painting', value: 72016, status: 'completed', progress: 100, location: 'Georgetown, KY', start_date: daysAgo(95), due_date: daysAgo(30) },
      { customer: 'Heritage Pool Supply', name: 'Heritage Pool – Showroom Refresh', category: 'Painting', value: 44500, status: 'completed', progress: 100, location: 'Lexington, KY', start_date: daysAgo(70), due_date: daysAgo(20) },
      // In progress  ($57,105)
      { customer: 'Corbin MOB', name: 'Corbin MOB – Restroom Renovation', category: 'Renovation', value: 38105, status: 'in_progress', progress: 60, location: 'Corbin, KY', start_date: daysAgo(25), due_date: daysAgo(-15) },
      { customer: 'Bluegrass CH', name: 'Bluegrass CH – Common Area Flooring', category: 'Flooring', value: 19000, status: 'in_progress', progress: 35, location: 'Versailles, KY', start_date: daysAgo(12), due_date: daysAgo(-22) },
      // Not started  ($70,750)
      { customer: 'Carl D. Perkins', name: 'Carl D. Perkins – Gymnasium Refinish', category: 'Flooring', value: 45750, status: 'not_started', progress: 0, location: 'Edmonton, KY', start_date: daysAgo(-10), due_date: daysAgo(-45) },
      { customer: 'Brandi Simon Law Office', name: 'Brandi Simon Law – Office Buildout', category: 'Renovation', value: 25000, status: 'not_started', progress: 0, location: 'Nicholasville, KY', start_date: daysAgo(-7), due_date: daysAgo(-38) },
    ] as const;

    const projectIds: Record<string, number> = {};
    projects.forEach((p) => {
      const id = insertProject.run(p).lastInsertRowid as number;
      projectIds[p.name] = id;
    });

    // ---- A few notes + time entries so the detail views aren't empty ------
    const corbin = projectIds['Corbin MOB – Restroom Renovation'];
    const bluegrass = projectIds['Bluegrass CH – Common Area Flooring'];

    insertNote.run(corbin, adminId, 'Will Deaton', 'Demo delayed one day — waiting on tile delivery from supplier.', isoTime(new Date(Date.now() - 4 * 864e5)));
    insertNote.run(corbin, mikeId, 'Mike Johnson', 'Framing and plumbing rough-in complete. Starting tile Thursday.', isoTime(new Date(Date.now() - 2 * 864e5)));
    insertNote.run(bluegrass, daveId, 'Dave Smith', 'Furniture moved and subfloor prepped in the east lobby.', isoTime(new Date(Date.now() - 1 * 864e5)));

    // Completed time entries
    insertTime.run(corbin, mikeId, isoTime(new Date(Date.now() - 2 * 864e5 - 8 * 36e5)), isoTime(new Date(Date.now() - 2 * 864e5)), 'Rough-in');
    insertTime.run(corbin, daveId, isoTime(new Date(Date.now() - 1 * 864e5 - 7 * 36e5)), isoTime(new Date(Date.now() - 1 * 864e5)), 'Demo & haul-off');
    insertTime.run(bluegrass, daveId, isoTime(new Date(Date.now() - 1 * 864e5 - 6 * 36e5)), isoTime(new Date(Date.now() - 1 * 864e5)), 'Subfloor prep');
  });

  seed();
}
