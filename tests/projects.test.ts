import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as clientModule from '../src/client.js';
import { listProjects, getProject } from '../src/tools/projects.js';

function parse(result: { content: Array<{ text?: string }> }): any {
  return JSON.parse(result.content[0].text as string);
}

const DETAILS = {
  _id: 'ev1',
  event_name: 'Meredith & Chris  Wedding',
  event_type: 'Event Management',
  project_type: 'Event Management',
  event_date: '2026-10-17',
  event_end_date: null,
  event_time_start: null,
  event_time_end: null,
  event_timezone: 'EDT',
  event_timezone_iana: 'America/New_York',
  event_location: 'DoubleTree by Hilton Charlotte City Center, 230 N College St, Charlotte, NC 28202',
  venue_name: null,
  event_guests: 120,
  event_budget: null,
  event_details: null,
  last_activity_date: '2026-09-02T21:10:04.593+00:00',
  project_dates: [],
  custom_project_fields_v2: [
    { name: 'Type of Package', label: 'Type of Package', type: 'text', order: 1, value: null },
    { name: 'Color', label: 'Color palette', type: 'text', order: 2, value: 'Lavender' },
  ],
  event_image: { url: 'https://img.example/cover.jpg', name: 'DSC_6584.jpg' },
  event_users: [
    {
      _id: 'vendor1',
      first_name: 'Ivy',
      last_name: 'Honeycutt',
      full_name: 'Ivy Honeycutt',
      email: 'ivy@example.com',
      phone_number: '+17045550100',
      system_user_type: 'vendor',
      user_type: 'event_planner',
      job_title: 'Event Planner',
      company: { company_name: 'The Silk Veil Events by Ivy LLC', account: { huge: 'blob' }, pipeline_views: [{}] },
      profile_image: { url: 'x' },
    },
    { _id: 'c1', first_name: 'Meredith', last_name: 'Hall', full_name: 'Meredith Hall', email: 'meredith@example.com', system_user_type: 'client', user_type: 'client', phone_number: '', job_title: '' },
    // the live API repeats a person who reaches the project by two paths
    { _id: 'c1', first_name: 'Meredith', last_name: 'Hall', full_name: 'Meredith Hall', email: 'meredith@example.com', system_user_type: 'client', user_type: 'client' },
  ],
  creator: { company: { _id: 'co', account: { enormous: true }, project_types: [{}], lead_sources: [{}] } },
  user_event_notes: [],
  company_notes: [],
};

describe('project tools', () => {
  let fakeClient: { request: ReturnType<typeof vi.fn>; scope: { portalOrigin: string; companyName: string; userId: string } };

  beforeEach(() => {
    fakeClient = {
      request: vi.fn(),
      scope: { portalOrigin: 'https://thesilkveileventsbyivy.hbportal.co', companyName: 'Silk Veil', userId: 'uid_24' },
    };
    vi.spyOn(clientModule, 'getActiveClient').mockResolvedValue(fakeClient as unknown as clientModule.HoneyBookClient);
  });
  afterEach(() => vi.restoreAllMocks());

  it('listProjects reads /client/events and returns a compact page', async () => {
    fakeClient.request.mockResolvedValueOnce({
      last_page: true,
      cur_page: 1,
      total_pages: 1,
      data: [
        { _id: 'ev1', workspace_id: 'ws1', created_at: '2026-04-12T13:18:26.998Z', event_name: 'Meredith & Chris  Wedding', event_date: '2026-10-17', is_booked: true },
        { _id: 'ev2', workspace_id: 'ws2', created_at: '2026-06-01T00:00:00.000Z', event_name: 'Rehearsal Dinner', event_date: null, is_booked: false },
      ],
    });
    const out = parse(await listProjects({}));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/client/events');
    expect(out).toEqual({
      projects: [
        { project_id: 'ev1', workspace_id: 'ws1', name: 'Meredith & Chris  Wedding', date: '2026-10-17', is_booked: true, created_at: '2026-04-12T13:18:26.998Z' },
        { project_id: 'ev2', workspace_id: 'ws2', name: 'Rehearsal Dinner', date: null, is_booked: false, created_at: '2026-06-01T00:00:00.000Z' },
      ],
      cur_page: 1,
      total_pages: 1,
      last_page: true,
    });
  });

  it('listProjects forwards page', async () => {
    fakeClient.request.mockResolvedValueOnce({ last_page: true, cur_page: 2, total_pages: 2, data: [] });
    await listProjects({ page: 2 });
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/client/events?page=2');
  });

  it('getProject summarizes /events/{id}/details and strips the vendor account blobs', async () => {
    fakeClient.request.mockResolvedValueOnce(DETAILS);
    const out = parse(await getProject({ project_id: 'ev1' }));
    expect(fakeClient.request).toHaveBeenCalledWith('GET', '/api/v2/events/ev1/details');
    expect(out).toEqual(
      expect.objectContaining({
        _id: 'ev1',
        name: 'Meredith & Chris  Wedding',
        type: 'Event Management',
        date: '2026-10-17',
        timezone: 'America/New_York',
        location: 'DoubleTree by Hilton Charlotte City Center, 230 N College St, Charlotte, NC 28202',
        guests: 120,
        image_url: 'https://img.example/cover.jpg',
        last_activity_date: '2026-09-02T21:10:04.593+00:00',
      })
    );
    expect(out.custom_fields).toEqual([{ label: 'Color palette', value: 'Lavender' }]);
    expect(out.people).toEqual([
      { _id: 'vendor1', name: 'Ivy Honeycutt', email: 'ivy@example.com', phone: '+17045550100', role: 'vendor', job_title: 'Event Planner', company: 'The Silk Veil Events by Ivy LLC' },
      { _id: 'c1', name: 'Meredith Hall', email: 'meredith@example.com', phone: undefined, role: 'client', job_title: undefined, company: undefined },
    ]);
    expect(JSON.stringify(out)).not.toContain('enormous');
    expect(JSON.stringify(out)).not.toContain('huge');
  });

  it('getProject section=raw returns the response untouched', async () => {
    fakeClient.request.mockResolvedValueOnce(DETAILS);
    const out = parse(await getProject({ project_id: 'ev1', section: 'raw' }));
    expect(out.creator.company.account.enormous).toBe(true);
  });
});
