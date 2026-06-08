import { describe, it, expect } from 'vitest';
import { buildPeopleBody, type AiArcPeopleFilters } from '@/lib/aiarc-api';

// buildPeopleBody converts our AiArcPeopleFilters vocabulary into AI Ark's raw
// nested request body. These tests lock in the tenure (experienceDuration) and
// negative (exclude) filters that the client previously dropped silently.

function build(filters: AiArcPeopleFilters) {
  // size/page are irrelevant to the filter mapping under test.
  return buildPeopleBody(filters, 0, 20) as any;
}

describe('buildPeopleBody — tenure (experienceDuration)', () => {
  it('maps currentJob min-only to contact.experience.current.duration (no synthetic max)', () => {
    const body = build({ experienceDuration: { currentJob: { min: { year: 10 } } } });
    expect(body.contact.experience.current.duration.currentJob).toEqual({
      min: { year: 10, month: 0 },
    });
  });

  it('maps all three metrics when provided', () => {
    const body = build({
      experienceDuration: {
        currentJob: { min: { year: 5 } },
        currentCompany: { min: { year: 3, month: 6 } },
        total: { min: { year: 15 } },
      },
    });
    const dur = body.contact.experience.current.duration;
    expect(dur.currentJob.min).toEqual({ year: 5, month: 0 });
    expect(dur.currentCompany.min).toEqual({ year: 3, month: 6 });
    expect(dur.total.min).toEqual({ year: 15, month: 0 });
  });

  it('emits a lone max for max-only ("at most N")', () => {
    const body = build({ experienceDuration: { currentJob: { max: { year: 2 } } } });
    expect(body.contact.experience.current.duration.currentJob).toEqual({
      max: { year: 2, month: 0 },
    });
  });

  it('omits duration entirely when no bounds are given', () => {
    const body = build({ experienceDuration: { currentJob: {} } });
    expect(body.contact?.experience).toBeUndefined();
  });
});

describe('buildPeopleBody — title include/exclude', () => {
  it('emits both include and exclude under title.any', () => {
    const body = build({
      titleKeywords: ['CEO'],
      titleKeywordsExclude: ['Assistant', 'Intern'],
      titleMode: 'SMART',
    });
    const any = body.contact.experience.current.title.any;
    expect(any.include).toEqual({ mode: 'SMART', content: ['CEO'] });
    expect(any.exclude).toEqual({ mode: 'SMART', content: ['Assistant', 'Intern'] });
  });

  it('remaps legacy titleMode EXACT to STRICT', () => {
    const body = build({ titleKeywords: ['CEO'], titleMode: 'EXACT' as any });
    expect(body.contact.experience.current.title.any.include.mode).toBe('STRICT');
  });

  it('defaults titleMode to WORD', () => {
    const body = build({ titleKeywords: ['CEO'] });
    expect(body.contact.experience.current.title.any.include.mode).toBe('WORD');
  });
});

describe('buildPeopleBody — title + duration coexist', () => {
  it('keeps title and duration on the same experience.current object', () => {
    const body = build({
      titleKeywords: ['CEO'],
      titleKeywordsExclude: ['Assistant'],
      experienceDuration: { currentJob: { min: { year: 10 } } },
    });
    const current = body.contact.experience.current;
    expect(current.title.any.include.content).toEqual(['CEO']);
    expect(current.title.any.exclude.content).toEqual(['Assistant']);
    expect(current.duration.currentJob.min.year).toBe(10);
  });
});

describe('buildPeopleBody — seniority & department exclude', () => {
  it('emits include and exclude for seniority', () => {
    const body = build({ seniority: ['c_level'], seniorityExclude: ['entry'] });
    expect(body.contact.seniority.any).toEqual({ include: ['c_level'], exclude: ['entry'] });
  });

  it('emits exclude-only for departments', () => {
    const body = build({ departmentsExclude: ['Sales'] });
    expect(body.contact.departmentAndFunction.any).toEqual({ exclude: ['Sales'] });
  });
});
