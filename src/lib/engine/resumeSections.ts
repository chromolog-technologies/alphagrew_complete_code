/**
 * Section-aware resume structuring.
 * Splits resume lines into their headed sections (experience, projects, skills, education...)
 * so roles, projects, skills and education are read only from the section they belong to.
 */

export type ResumeSectionKey =
  | 'header'
  | 'summary'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'education'
  | 'certifications'
  | 'other';

// Order matters: combined headings ("Education & Certifications") must match before their parts
const SECTION_HEADINGS: [ResumeSectionKey, RegExp][] = [
  ['education', /^(?:education\s*(?:&|and)\s*certifications?|education|academic profile|academic background|academic qualifications?|educational qualifications?|qualifications)$/i],
  ['experience', /^(?:work experience|professional experience|relevant experience|experience|employment history|employment|work history|career history|internships?)$/i],
  ['projects', /^(?:projects|key projects|academic projects|personal projects|selected projects|project work|project works|project experience)$/i],
  ['skills', /^(?:technical skills|skills|key skills|core skills|core competencies|competencies|areas of expertise|skills\s*(?:&|and)\s*tools|tools\s*(?:&|and)\s*technologies|tools\s*(?:&|and)\s*platforms|technologies|tech stack)$/i],
  ['summary', /^(?:professional summary|summary|profile|professional profile|about me|career objective|objective|overview|career summary)$/i],
  ['certifications', /^(?:certifications?|licenses?(?:\s*(?:&|and)\s*certifications?)?|courses|training)$/i],
  ['other', /^(?:awards|achievements|honors|languages|hobbies|interests|references|declaration|personal details|strengths|volunteering|publications|extra[- ]curricular activities)$/i]
];

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Matches "Aug 2024 - Present", "Sep 2023 – Jul 2024", "2019 - 2021", "(2020 to Present)" */
export const DATE_RANGE_REGEX = new RegExp(
  `(?:(${MONTH})\\s+)?((?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(?:(present|current|now|till date|date)|(?:(${MONTH})\\s+)?((?:19|20)\\d{2}))`,
  'i'
);

export const ROLE_TITLE_REGEX = /\b(accountant|auditor|controller|treasurer|actuary|underwriter|banker|trader|bookkeeper|analyst|recruiter|talent acquisition|sourcer|generalist|hrbp|human resources|marketer|copywriter|strategist|account executive|representative|business development|nurse|physician|doctor|therapist|pharmacist|clinician|dentist|paramedic|counsel|attorney|lawyer|paralegal|compliance officer|advisor|teacher|educator|professor|instructor|lecturer|tutor|principal|dean|buyer|scrum master|designer|art director|engineer|developer|architect|programmer|scientist|administrator|coordinator|specialist|consultant|officer|executive|lead|director|manager|intern|associate|trainee|assistant|head|founder|owner|president|partner)\b/i;

const ACTION_VERB_REGEX = /^(?:built|architected|designed|developed|implemented|optimized|scaled|reduced|created|managed|directed|spearheaded|engineered|led|delivered|handled|improved|analyzed|coordinated|maintained|authored|resolved|established|automated|launched|sourced|screened|conducted|reviewed|partnered|recruited|initiated|tracked|deployed|migrated|configured|facilitated|cut|rolled|grew|increased|decreased|negotiated|trained|mentored|introduced|redesigned|streamlined|owned|wrote|worked|debugged|integrated|collaborated|supported|prepared|ensured|tested|executed|planned|organized|taught|treated|drafted|achieved|won|served|assisted|consumed|used)\b/i;

const BULLET_PREFIX_REGEX = /^[•\-\*–—▪●◦»>]\s*/;
const INSTITUTION_REGEX = /\b(?:university|universiti|institute|institution|college|school|academy|vidyapeetham|vidyapith|polytechnic|iit|nit|iiit|iim)\b/i;
const DEGREE_REGEX = /\b(?:bachelor|master|masters|phd|ph\.d|doctorate|b\.?\s?s\.?c|m\.?\s?s\.?c|b\.?\s?tech|m\.?\s?tech|mba|bba|bca|mca|b\.?com|m\.?com|bsn|msn|llb|llm|diploma|associate degree|higher secondary|hsc|ssc|12th|10th|class xii|class x)\b/i;
// Short degree codes collide with words ("be", "ma"), so they are matched case-sensitively
const SHORT_DEGREE_REGEX = /\b(?:B\.?E|M\.?E|B\.?A|M\.?A|B\.?S|M\.?S)\b/;
const isDegreeLine = (line: string) => DEGREE_REGEX.test(line) || SHORT_DEGREE_REGEX.test(line);

export interface ResumeExperienceEntry {
  role: string;
  organization: string;
  duration: string;
  startMonth?: number; // months since year 0, for interval math
  endMonth?: number;
  highlights: string[];
}

export interface ResumeProjectEntry {
  name: string;
  highlights: string[];
}

export interface ResumeEducationEntry {
  degree: string;
  institution: string;
  year: string;
}

export interface ResumeSkillGroup {
  label: string;
  items: string[];
}

export interface StructuredResume {
  sections: Partial<Record<ResumeSectionKey, string[]>>;
  experience: ResumeExperienceEntry[];
  projects: ResumeProjectEntry[];
  skillGroups: ResumeSkillGroup[];
  education: ResumeEducationEntry[];
}

function normalizeHeading(line: string): string {
  return line.replace(BULLET_PREFIX_REGEX, '').replace(/[:\-–—\s]+$/, '').replace(/\s+/g, ' ').trim();
}

export function detectSectionHeading(line: string): ResumeSectionKey | null {
  const heading = normalizeHeading(line);
  if (!heading || heading.length > 45) return null;
  for (const [key, regex] of SECTION_HEADINGS) {
    if (regex.test(heading)) return key;
  }
  return null;
}

export function splitResumeSections(lines: string[]): Partial<Record<ResumeSectionKey, string[]>> {
  const sections: Partial<Record<ResumeSectionKey, string[]>> = {};
  let current: ResumeSectionKey = 'header';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = detectSectionHeading(line);
    if (heading) {
      current = heading;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    (sections[current] ||= []).push(line);
  }
  return sections;
}

function toMonthIndex(month: string | undefined, year: string, isEnd: boolean): number {
  const m = month ? MONTH_INDEX[month.slice(0, 3).toLowerCase()] : undefined;
  return parseInt(year, 10) * 12 + (m !== undefined ? m : isEnd ? 11 : 0);
}

export function parseDateRange(text: string): { duration: string; startMonth: number; endMonth: number } | null {
  const match = text.match(DATE_RANGE_REGEX);
  if (!match) return null;
  const [full, startMonthName, startYear, presentWord, endMonthName, endYear] = match;
  const now = new Date();
  const startMonth = toMonthIndex(startMonthName, startYear, false);
  const endMonth = presentWord
    ? now.getFullYear() * 12 + now.getMonth()
    : toMonthIndex(endMonthName, endYear, true);
  return { duration: full.trim(), startMonth, endMonth };
}

const isBulletLine = (line: string) => BULLET_PREFIX_REGEX.test(line);
const stripBullet = (line: string) => line.replace(BULLET_PREFIX_REGEX, '').trim();
const isSentenceLike = (line: string) =>
  ACTION_VERB_REGEX.test(stripBullet(line)) || /[.!?]$/.test(line) || stripBullet(line).split(/\s+/).length > 12;
const isDateOnlyLine = (line: string) => {
  const range = line.match(DATE_RANGE_REGEX);
  return Boolean(range) && line.replace(DATE_RANGE_REGEX, '').replace(/[()|,\s]/g, '').length === 0;
};

/** "Development Team Lead - Inditech Pvt Ltd, Kochi" / "Acme Corp | Senior Analyst" -> role + organization */
function splitRoleAndOrganization(header: string): { role: string; organization: string } {
  const cleaned = header.replace(DATE_RANGE_REGEX, '').replace(/\(\s*\)/g, '').replace(/[|,\-–—\s]+$/, '').trim();
  let parts = cleaned.split(/\s+[-–—|]\s+|\s+@\s+|\s+at\s+/i).map(p => p.trim()).filter(Boolean);
  // "Junior Associate Intern, Eduzell Technologies" -> split the first part at its comma when the role comes first
  if (parts.length >= 1 && parts[0].includes(',')) {
    const [beforeComma, ...afterComma] = parts[0].split(',');
    if (ROLE_TITLE_REGEX.test(beforeComma)) {
      parts = [beforeComma.trim(), afterComma.join(',').trim(), ...parts.slice(1)].filter(Boolean);
    }
  }
  const roleIndex = parts.findIndex(p => ROLE_TITLE_REGEX.test(p));
  if (roleIndex === -1) return { role: parts[0] || cleaned, organization: parts.slice(1).join(', ') };
  return {
    role: parts[roleIndex],
    organization: parts.filter((_, i) => i !== roleIndex).join(', ')
  };
}

function parseExperience(lines: string[]): ResumeExperienceEntry[] {
  const entries: ResumeExperienceEntry[] = [];
  let current: ResumeExperienceEntry | null = null;

  for (const line of lines) {
    if (isDateOnlyLine(line)) {
      // A date printed on its own line (right-aligned column) belongs to the entry being read
      const range = parseDateRange(line);
      if (current && range && !current.duration) Object.assign(current, range);
      continue;
    }

    // Judge sentence-likeness without the dates, so "Role, Company - City Sep 2023 - Jul 2024" isn't too "long"
    const withoutDates = line.replace(DATE_RANGE_REGEX, '').replace(/[()]/g, '').trim();
    const looksLikeHeader =
      !isBulletLine(line) &&
      !isSentenceLike(withoutDates) &&
      line.length < 120 &&
      (ROLE_TITLE_REGEX.test(line) || DATE_RANGE_REGEX.test(line));

    if (looksLikeHeader) {
      const { role, organization } = splitRoleAndOrganization(line);
      const range = parseDateRange(line);
      current = { role, organization, duration: range?.duration || '', startMonth: range?.startMonth, endMonth: range?.endMonth, highlights: [] };
      entries.push(current);
      continue;
    }

    // A bare organization/location line right after the header ("Acme Corp, Bangalore")
    if (current && current.highlights.length === 0 && !current.organization && !isSentenceLike(line) && !isBulletLine(line) && line.length < 80) {
      current.organization = line;
      continue;
    }

    if (current) current.highlights.push(stripBullet(line));
  }

  return entries;
}

function parseProjects(lines: string[]): ResumeProjectEntry[] {
  const entries: ResumeProjectEntry[] = [];
  let current: ResumeProjectEntry | null = null;

  for (const line of lines) {
    const isTitle = !isBulletLine(line) && !isSentenceLike(line) && line.length < 90;
    if (isTitle) {
      const name = line.replace(DATE_RANGE_REGEX, '').replace(/[|,\-–—:\s]+$/, '').trim();
      current = { name: name || line, highlights: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      current = { name: 'Project', highlights: [] };
      entries.push(current);
    }
    current.highlights.push(stripBullet(line));
  }

  return entries.filter(e => e.highlights.length > 0 || e.name !== 'Project');
}

function parseSkills(lines: string[]): ResumeSkillGroup[] {
  const groups: ResumeSkillGroup[] = [];
  for (const line of lines) {
    const content = stripBullet(line);
    const labelMatch = content.match(/^([A-Za-z][A-Za-z &/+.-]{1,30}):\s*(.+)$/);
    const label = labelMatch ? labelMatch[1].trim() : '';
    const body = labelMatch ? labelMatch[2] : content;
    const items = body
      .split(/\s*[,|•;]\s*|\s{3,}/)
      .map(item => item.replace(/[.]$/, '').trim())
      .filter(item => item.length >= 1 && item.length <= 40 && !/@|https?:\/\//.test(item));
    if (items.length > 0) groups.push({ label, items });
  }
  return groups;
}

function parseEducation(lines: string[]): ResumeEducationEntry[] {
  const entries: ResumeEducationEntry[] = [];
  let current: ResumeEducationEntry | null = null;

  for (const rawLine of lines) {
    const line = stripBullet(rawLine);
    if (/^(?:cgpa|gpa|percentage|grade|score|marks)\b/i.test(line)) continue;
    const yearMatch = line.match(DATE_RANGE_REGEX) || line.match(/\b((?:19|20)\d{2})\b/);
    // Prefer the graduation (end) year of a range
    const year = yearMatch ? (yearMatch[5] || yearMatch[2] || yearMatch[1] || '') : '';
    const withoutYear = line.replace(DATE_RANGE_REGEX, '').replace(/[(\[]?\b(?:19|20)\d{2}\b[)\]]?/g, '').replace(/[|,\-–—\s]+$/, '').trim();

    if (isDegreeLine(line)) {
      // "B.Sc Computer Science - Bharathiar University" may hold both on one line
      const [degreePart, ...rest] = withoutYear.split(/\s+[-–—|]\s+|,\s+(?=[^,]*(?:university|institute|college|school|academy|vidyapeetham))/i);
      current = { degree: degreePart.trim(), institution: rest.join(', ').trim(), year };
      entries.push(current);
    } else if (INSTITUTION_REGEX.test(line) && current && !current.institution) {
      current.institution = withoutYear;
      if (!current.year && year) current.year = year;
    } else if (INSTITUTION_REGEX.test(line)) {
      current = { degree: '', institution: withoutYear, year };
      entries.push(current);
    }
  }

  return entries.filter(e => e.degree || e.institution);
}

export function structureResume(lines: string[]): StructuredResume {
  const sections = splitResumeSections(lines);
  return {
    sections,
    experience: parseExperience(sections.experience || []),
    projects: parseProjects(sections.projects || []),
    skillGroups: parseSkills(sections.skills || []),
    education: parseEducation(sections.education || [])
  };
}

/** Total professional experience in whole years, merging overlapping roles. */
export function computeExperienceYears(entries: ResumeExperienceEntry[]): number | null {
  const ranges = entries
    .filter(e => e.startMonth !== undefined && e.endMonth !== undefined && e.endMonth! >= e.startMonth!)
    .map(e => [e.startMonth!, e.endMonth!] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  if (ranges.length === 0) return null;

  let totalMonths = 0;
  let [curStart, curEnd] = ranges[0];
  for (const [start, end] of ranges.slice(1)) {
    if (start <= curEnd + 1) {
      curEnd = Math.max(curEnd, end);
    } else {
      totalMonths += curEnd - curStart + 1;
      [curStart, curEnd] = [start, end];
    }
  }
  totalMonths += curEnd - curStart + 1;
  return Math.max(1, Math.round(totalMonths / 12));
}
