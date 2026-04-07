'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, AlertCircle, Check, ChevronDown, ChevronUp, UserPlus, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import type { AiArcPeopleFilters, AiArcCompanyFilters, AiArcPerson, AiArcCompany } from '@/lib/aiarc-api';

interface AddAiArcDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  workbookId?: string;
  onComplete: (newSheetId?: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SENIORITY_OPTIONS = [
  'owner', 'founder', 'c_suite', 'partner', 'vp', 'head',
  'director', 'manager', 'senior', 'entry_level', 'intern',
];

const DEPARTMENT_OPTIONS = [
  'Engineering', 'Sales', 'Marketing', 'Finance', 'Human Resources',
  'Operations', 'Legal', 'Support', 'Design', 'Product Management',
  'Data', 'Consulting', 'Education', 'Media', 'Research',
];

const EMPLOYEE_SIZE_OPTIONS = [
  { label: '1-10', start: 1, end: 10 },
  { label: '11-50', start: 11, end: 50 },
  { label: '51-200', start: 51, end: 200 },
  { label: '201-500', start: 201, end: 500 },
  { label: '501-1,000', start: 501, end: 1000 },
  { label: '1,001-5,000', start: 1001, end: 5000 },
  { label: '5,001-10,000', start: 5001, end: 10000 },
  { label: '10,001+', start: 10001, end: 1000000 },
];

const PEOPLE_OUTPUT_COLUMNS = [
  { name: 'First Name', type: 'text', key: 'first_name' },
  { name: 'Last Name', type: 'text', key: 'last_name' },
  { name: 'Full Name', type: 'text', key: 'full_name' },
  { name: 'Job Title', type: 'text', key: 'title' },
  { name: 'Headline', type: 'text', key: 'headline' },
  { name: 'Seniority', type: 'text', key: 'seniority' },
  { name: 'Location', type: 'text', key: 'location' },
  { name: 'Country', type: 'text', key: 'country' },
  { name: 'Company Name', type: 'text', key: 'company_name' },
  { name: 'Company Domain', type: 'url', key: 'company_domain' },
  { name: 'Company Industry', type: 'text', key: 'company_industry' },
  { name: 'LinkedIn URL', type: 'url', key: 'linkedin_url' },
  { name: 'Twitter', type: 'url', key: 'twitter_url' },
  { name: 'Skills', type: 'text', key: 'skills' },
];

const COMPANY_OUTPUT_COLUMNS = [
  { name: 'Company Name', type: 'text', key: 'name' },
  { name: 'Legal Name', type: 'text', key: 'legal_name' },
  { name: 'Industry', type: 'text', key: 'industry' },
  { name: 'Website', type: 'url', key: 'website' },
  { name: 'Domain', type: 'url', key: 'domain' },
  { name: 'LinkedIn URL', type: 'url', key: 'linkedin_url' },
  { name: 'Staff Count', type: 'number', key: 'staff_total' },
  { name: 'Staff Range', type: 'text', key: 'staff_range' },
  { name: 'Founded Year', type: 'number', key: 'founded_year' },
  { name: 'Funding Type', type: 'text', key: 'funding_type' },
  { name: 'Total Funding', type: 'text', key: 'funding_total' },
  { name: 'HQ City', type: 'text', key: 'headquarter_city' },
  { name: 'HQ State', type: 'text', key: 'headquarter_state' },
  { name: 'Technologies', type: 'text', key: 'technologies' },
  { name: 'Description', type: 'text', key: 'description' },
  { name: 'Email', type: 'email', key: 'email' },
  { name: 'Phone', type: 'text', key: 'phone' },
];

// ─── Helper Components ──────────────────────────────────────────────────────

function FilterSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] hover:bg-white/[0.05] transition-colors"
      >
        <span className="text-sm font-medium text-white/70">{title}</span>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-violet-500/20 text-violet-400 rounded-full">
              {count}
            </span>
          )}
          <ChevronDown className={cn('w-4 h-4 text-white/40 transition-transform', open && 'rotate-180')} />
        </div>
      </button>
      {open && <div className="p-3 space-y-3 border-t border-white/10">{children}</div>}
    </div>
  );
}

function TextFilterInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-white/50 mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Comma-separated values...'}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400"
      />
    </div>
  );
}

function NumberFilterInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const numVal = value ? Number(value) : 0;
  const increment = () => onChange(String(numVal + 1));
  const decrement = () => onChange(String(Math.max(0, numVal - 1)));
  return (
    <div>
      <label className="text-xs text-white/50 mb-1 block">{label}</label>
      <div className="flex border border-white/10 rounded-lg overflow-hidden focus-within:border-violet-400">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder={placeholder || ''}
          className="flex-1 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <div className="flex flex-col border-l border-white/10 bg-white/[0.03]">
          <button type="button" onClick={increment}
            className="flex items-center justify-center w-7 flex-1 hover:bg-white/10 transition-colors text-white/40 hover:text-white">
            <ChevronUp className="w-3 h-3" />
          </button>
          <div className="border-t border-white/10" />
          <button type="button" onClick={decrement}
            className="flex items-center justify-center w-7 flex-1 hover:bg-white/10 transition-colors text-white/40 hover:text-white">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckboxGroup({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  };
  return (
    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={cn(
            'px-2 py-1 text-xs rounded-md border transition-colors',
            selected.includes(opt)
              ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
              : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SizeCheckboxGroup({ selected, onChange }: {
  selected: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (label: string) => {
    onChange(selected.includes(label) ? selected.filter(s => s !== label) : [...selected, label]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {EMPLOYEE_SIZE_OPTIONS.map(opt => (
        <button
          key={opt.label}
          type="button"
          onClick={() => toggle(opt.label)}
          className={cn(
            'px-2 py-1 text-xs rounded-md border transition-colors',
            selected.includes(opt.label)
              ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
              : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function AddAiArcDataModal({ isOpen, onClose, tableId, workbookId, onComplete }: AddAiArcDataModalProps) {
  const { fetchTable, fetchWorkbook } = useTableStore();
  const abortRef = useRef<AbortController | null>(null);

  // Step state
  const [step, setStep] = useState<'configure' | 'searching' | 'results'>('configure');
  const [searchType, setSearchType] = useState<'people' | 'companies'>('people');

  // People filters
  const [titleKeywords, setTitleKeywords] = useState('');
  const [titleMode, setTitleMode] = useState<'SMART' | 'WORD' | 'EXACT'>('SMART');
  const [seniority, setSeniority] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [skills, setSkills] = useState('');
  const [certifications, setCertifications] = useState('');
  const [schoolNames, setSchoolNames] = useState('');
  const [pLanguages, setPLanguages] = useState('');
  const [fullName, setFullName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [contactLocation, setContactLocation] = useState('');
  const [companyDomain, setCompanyDomain] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [industries, setIndustries] = useState('');
  const [employeeSizes, setEmployeeSizes] = useState<string[]>([]);
  const [accountLocation, setAccountLocation] = useState('');
  const [technology, setTechnology] = useState('');
  const [limit, setLimit] = useState('50');

  // Company filters
  const [cLookalike, setCLookalike] = useState('');
  const [cDomain, setCDomain] = useState('');
  const [cName, setCName] = useState('');
  const [cIndustries, setCIndustries] = useState('');
  const [cSizes, setCSizes] = useState<string[]>([]);
  const [cLocation, setCLocation] = useState('');
  const [cTechnology, setCTechnology] = useState('');
  const [cKeywords, setCKeywords] = useState('');
  const [cFundingType, setCFundingType] = useState('');
  const [cLimit, setCLimit] = useState('50');

  // Search state
  const [searchStatus, setSearchStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null);
  const [peopleResults, setPeopleResults] = useState<AiArcPerson[]>([]);
  const [companyResults, setCompanyResults] = useState<AiArcCompany[]>([]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep('configure');
      setError(null);
      setPeopleResults([]);
      setCompanyResults([]);
      setSearchStatus('');
      setEstimatedTotal(null);
    }
  }, [isOpen]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const splitCSV = (s: string): string[] => s.split(',').map(v => v.trim()).filter(Boolean);
  const toNum = (s: string): number | null => s ? Number(s) : null;

  const sizesToRanges = (labels: string[]) => {
    return EMPLOYEE_SIZE_OPTIONS
      .filter(o => labels.includes(o.label))
      .map(o => ({ start: o.start, end: o.end }));
  };

  const countActive = (...vals: (string | string[] | boolean)[]): number =>
    vals.reduce<number>((n, v) => {
      if (typeof v === 'boolean') return n + (v ? 1 : 0);
      if (Array.isArray(v)) return n + (v.length > 0 ? 1 : 0);
      return n + (v.trim() ? 1 : 0);
    }, 0);

  // People filter counts
  const jobCount = countActive(titleKeywords, seniority, departments);
  const pLocationCount = countActive(contactLocation, accountLocation);
  const pCompanyCount = countActive(companyDomain, companyName, industries, employeeSizes);
  const pSkillCount = countActive(skills, certifications, schoolNames, pLanguages);
  const pProfileCount = countActive(fullName, linkedinUrl);

  // Company filter counts
  const cIdentCount = countActive(cDomain, cName, cLookalike);
  const cIndustryCount = countActive(cIndustries);
  const cSizeCount = countActive(cSizes);
  const cLocCount = countActive(cLocation);
  const cTechCount = countActive(cTechnology, cKeywords);
  const cFundCount = countActive(cFundingType);

  // ─── Build Filters ────────────────────────────────────────────────────────

  const buildPeopleFilters = (): AiArcPeopleFilters => {
    const filters: AiArcPeopleFilters = {};
    if (titleKeywords.trim()) { filters.titleKeywords = splitCSV(titleKeywords); filters.titleMode = titleMode; }
    if (seniority.length) filters.seniority = seniority;
    if (departments.length) filters.departments = departments;
    if (skills.trim()) filters.skills = splitCSV(skills);
    if (certifications.trim()) filters.certifications = splitCSV(certifications);
    if (schoolNames.trim()) filters.schoolNames = splitCSV(schoolNames);
    if (pLanguages.trim()) filters.languages = splitCSV(pLanguages);
    if (fullName.trim()) filters.fullName = fullName.trim();
    if (linkedinUrl.trim()) filters.linkedinUrl = linkedinUrl.trim();
    if (contactLocation.trim()) filters.contactLocation = splitCSV(contactLocation);
    if (companyDomain.trim()) filters.companyDomain = splitCSV(companyDomain);
    if (companyName.trim()) filters.companyName = splitCSV(companyName);
    if (industries.trim()) filters.industries = splitCSV(industries);
    if (employeeSizes.length) filters.employeeSize = sizesToRanges(employeeSizes);
    if (accountLocation.trim()) filters.accountLocation = splitCSV(accountLocation);
    if (technology.trim()) filters.technology = splitCSV(technology);
    filters.limit = toNum(limit) ?? 50;
    return filters;
  };

  const buildCompanyFilters = (): AiArcCompanyFilters => {
    const filters: AiArcCompanyFilters = {};
    if (cLookalike.trim()) filters.lookalikeDomains = splitCSV(cLookalike).slice(0, 5);
    if (cDomain.trim()) filters.domain = splitCSV(cDomain);
    if (cName.trim()) filters.name = splitCSV(cName);
    if (cIndustries.trim()) filters.industries = splitCSV(cIndustries);
    if (cSizes.length) filters.employeeSize = sizesToRanges(cSizes);
    if (cLocation.trim()) filters.location = splitCSV(cLocation);
    if (cTechnology.trim()) filters.technology = splitCSV(cTechnology);
    if (cKeywords.trim()) filters.keywords = splitCSV(cKeywords);
    if (cFundingType.trim()) filters.fundingType = splitCSV(cFundingType);
    filters.limit = toNum(cLimit) ?? 50;
    return filters;
  };

  // ─── Search ───────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    setStep('searching');
    setError(null);
    setSearchStatus('Running preview to estimate results...');

    try {
      abortRef.current = new AbortController();
      const isCompany = searchType === 'companies';
      const filters = isCompany ? buildCompanyFilters() : buildPeopleFilters();
      const searchLimit = isCompany ? (toNum(cLimit) ?? 50) : (toNum(limit) ?? 50);

      // Step 1: Preview to get estimated total
      const previewRes = await fetch('/api/add-aiarc-data/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType, filters }),
        signal: abortRef.current.signal,
      });

      if (!previewRes.ok) {
        const err = await previewRes.json().catch(() => ({ error: 'Preview failed' }));
        throw new Error(err.error || `Error ${previewRes.status}`);
      }

      const preview = await previewRes.json();
      const total = preview.estimatedTotal || 0;
      setEstimatedTotal(total);

      if (total === 0) {
        setError('No results found. Try broadening your filters.');
        setStep('configure');
        return;
      }

      // Step 2: Full search
      const fetchCount = Math.min(searchLimit, total);
      setSearchStatus(`Found ~${total.toLocaleString()} results. Fetching ${fetchCount.toLocaleString()}...`);

      const searchRes = await fetch('/api/add-aiarc-data/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchType, filters, limit: searchLimit }),
        signal: abortRef.current.signal,
      });

      if (!searchRes.ok) {
        const err = await searchRes.json().catch(() => ({ error: 'Search failed' }));
        throw new Error(err.error || `Error ${searchRes.status}`);
      }

      const data = await searchRes.json();
      if (isCompany) {
        setCompanyResults(data.companies || []);
      } else {
        setPeopleResults(data.people || []);
      }
      setStep('results');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStep('configure');
        return;
      }
      setError((err as Error).message);
      setStep('configure');
    }
  };

  // ─── Add to Table ─────────────────────────────────────────────────────────

  const handleAddToTable = async () => {
    const isCompanyMode = searchType === 'companies';
    const outputCols = isCompanyMode ? COMPANY_OUTPUT_COLUMNS : PEOPLE_OUTPUT_COLUMNS;
    const items = isCompanyMode ? companyResults : peopleResults;
    if (items.length === 0) return;

    setStep('searching');
    setSearchStatus('Creating new sheet...');

    try {
      let targetTableId = tableId;

      if (workbookId) {
        const sheetName = isCompanyMode ? 'Companies (AI Arc)' : 'People (AI Arc)';
        const res = await fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: workbookId, name: sheetName }),
        });
        if (!res.ok) throw new Error('Failed to create new sheet');
        const newTable = await res.json();
        targetTableId = newTable.id;
      }

      setSearchStatus('Adding columns...');

      const colIdMap: Record<string, string> = {};
      for (const outCol of outputCols) {
        const res = await fetch('/api/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: targetTableId, name: outCol.name, type: outCol.type }),
        });
        const col = await res.json();
        colIdMap[outCol.key] = col.id;
      }

      // Build rows
      const rowData = items.map(item => {
        const data: Record<string, { value: string | number }> = {};
        for (const outCol of outputCols) {
          const colId = colIdMap[outCol.key];
          if (colId) {
            const val = (item as unknown as Record<string, unknown>)[outCol.key];
            data[colId] = { value: val != null ? String(val) : '' };
          }
        }
        return data;
      });

      // Insert rows in batches
      const BATCH_SIZE = 200;
      for (let i = 0; i < rowData.length; i += BATCH_SIZE) {
        const batch = rowData.slice(i, i + BATCH_SIZE);
        await fetch('/api/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: targetTableId, rows: batch }),
        });
        setSearchStatus(`Added ${Math.min(i + BATCH_SIZE, rowData.length)} / ${rowData.length} rows...`);
      }

      if (workbookId && targetTableId !== tableId) {
        await fetchWorkbook(workbookId, targetTableId);
        onComplete(targetTableId);
      } else {
        await fetchTable(tableId);
        onComplete();
      }
    } catch (err) {
      setError((err as Error).message);
      setStep('results');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setStep('configure');
  };

  if (!isOpen) return null;

  const selectClasses = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-violet-400 appearance-none bg-[length:16px_16px] bg-[position:right_0.5rem_center] bg-no-repeat bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20width%3D%2716%27%20height%3D%2716%27%20viewBox%3D%270%200%2024%2024%27%20fill%3D%27none%27%20stroke%3D%27rgba(255%2C255%2C255%2C0.4)%27%20stroke-width%3D%272%27%3E%3Cpath%20d%3D%27M6%209l6%206%206-6%27/%3E%3C/svg%3E")]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add AI Arc Data" size="full">
      <div className="max-h-[70vh] overflow-y-auto">

        {/* ─── Step 1: Configure ──────────────────────────────────── */}
        {step === 'configure' && (
          <div className="p-4 space-y-4">
            {/* Header badge */}
            <div className="flex items-center gap-2 p-2 bg-violet-500/10 border border-violet-500/20 rounded-lg">
              <Zap className="w-4 h-4 text-violet-400" />
              <span className="text-xs text-violet-300">Powered by AI Arc — 400M+ profiles, 68M+ companies</span>
            </div>

            {/* Search Type Toggle */}
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button type="button" onClick={() => setSearchType('people')}
                className={cn('flex-1 px-3 py-2 text-sm font-medium transition-colors border-r border-white/10',
                  searchType === 'people' ? 'bg-violet-500/20 text-white' : 'bg-white/5 text-white/50')}>
                Find People
              </button>
              <button type="button" onClick={() => setSearchType('companies')}
                className={cn('flex-1 px-3 py-2 text-sm font-medium transition-colors',
                  searchType === 'companies' ? 'bg-violet-500/20 text-white' : 'bg-white/5 text-white/50')}>
                Find Companies
              </button>
            </div>

            {/* ── People Mode ── */}
            {searchType === 'people' && (
              <div className="space-y-3">
                <NumberFilterInput label="Results Limit" value={limit} onChange={setLimit} placeholder="50" />

                <p className="text-sm font-medium text-white/70">People Filters</p>

                {/* Job & Role */}
                <FilterSection title="Job & Role" count={jobCount}>
                  <TextFilterInput label="Title Keywords" value={titleKeywords} onChange={setTitleKeywords} placeholder="CEO, CTO, Engineer..." />
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Title Match Mode</label>
                    <select value={titleMode} onChange={e => setTitleMode(e.target.value as 'SMART' | 'WORD' | 'EXACT')} className={selectClasses}>
                      <option value="SMART">Smart (default)</option>
                      <option value="WORD">Word Match</option>
                      <option value="EXACT">Exact Match</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Seniority Levels</label>
                    <CheckboxGroup options={SENIORITY_OPTIONS} selected={seniority} onChange={setSeniority} />
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Departments</label>
                    <CheckboxGroup options={DEPARTMENT_OPTIONS} selected={departments} onChange={setDepartments} />
                  </div>
                </FilterSection>

                {/* Location */}
                <FilterSection title="Location" count={pLocationCount}>
                  <TextFilterInput label="Person Location" value={contactLocation} onChange={setContactLocation} placeholder="Jakarta, New York, London..." />
                  <TextFilterInput label="Company Location" value={accountLocation} onChange={setAccountLocation} placeholder="Indonesia, United States..." />
                </FilterSection>

                {/* Company */}
                <FilterSection title="Company" count={pCompanyCount}>
                  <TextFilterInput label="Company Domain" value={companyDomain} onChange={setCompanyDomain} placeholder="google.com, stripe.com..." />
                  <TextFilterInput label="Company Name" value={companyName} onChange={setCompanyName} placeholder="Google, Stripe..." />
                  <TextFilterInput label="Industries" value={industries} onChange={setIndustries} placeholder="Technology, Finance..." />
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Employee Size</label>
                    <SizeCheckboxGroup selected={employeeSizes} onChange={setEmployeeSizes} />
                  </div>
                  <TextFilterInput label="Technology Stack" value={technology} onChange={setTechnology} placeholder="React, AWS, Salesforce..." />
                </FilterSection>

                {/* Skills & Education */}
                <FilterSection title="Skills & Education" count={pSkillCount}>
                  <TextFilterInput label="Skills" value={skills} onChange={setSkills} placeholder="Python, Machine Learning..." />
                  <TextFilterInput label="Certifications" value={certifications} onChange={setCertifications} placeholder="PMP, AWS Certified..." />
                  <TextFilterInput label="School Names" value={schoolNames} onChange={setSchoolNames} placeholder="MIT, Stanford..." />
                  <TextFilterInput label="Languages" value={pLanguages} onChange={setPLanguages} placeholder="English, Indonesian..." />
                </FilterSection>

                {/* Profile */}
                <FilterSection title="Profile" count={pProfileCount}>
                  <TextFilterInput label="Full Name" value={fullName} onChange={setFullName} placeholder="John Doe" />
                  <TextFilterInput label="LinkedIn URL" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="https://linkedin.com/in/..." />
                </FilterSection>
              </div>
            )}

            {/* ── Company Mode ── */}
            {searchType === 'companies' && (
              <div className="space-y-3">
                <NumberFilterInput label="Results Limit" value={cLimit} onChange={setCLimit} placeholder="50" />

                <p className="text-sm font-medium text-white/70">Company Filters</p>

                {/* Identification */}
                <FilterSection title="Identification" count={cIdentCount}>
                  <TextFilterInput label="Company Domain" value={cDomain} onChange={setCDomain} placeholder="google.com, amazon.com..." />
                  <TextFilterInput label="Company Name" value={cName} onChange={setCName} placeholder="Google, Amazon..." />
                  <TextFilterInput label="Lookalike Domains (max 5)" value={cLookalike} onChange={setCLookalike} placeholder="LinkedIn company URLs or domains..." />
                </FilterSection>

                {/* Industry */}
                <FilterSection title="Industry" count={cIndustryCount}>
                  <TextFilterInput label="Industries" value={cIndustries} onChange={setCIndustries} placeholder="Technology, Retail, Healthcare..." />
                </FilterSection>

                {/* Size */}
                <FilterSection title="Employee Size" count={cSizeCount}>
                  <SizeCheckboxGroup selected={cSizes} onChange={setCSizes} />
                </FilterSection>

                {/* Location */}
                <FilterSection title="Location" count={cLocCount}>
                  <TextFilterInput label="Location" value={cLocation} onChange={setCLocation} placeholder="United States, Jakarta..." />
                </FilterSection>

                {/* Technology & Keywords */}
                <FilterSection title="Technology & Keywords" count={cTechCount}>
                  <TextFilterInput label="Technologies" value={cTechnology} onChange={setCTechnology} placeholder="React, AWS, Salesforce..." />
                  <TextFilterInput label="Keywords" value={cKeywords} onChange={setCKeywords} placeholder="AI, SaaS, B2B..." />
                </FilterSection>

                {/* Financial */}
                <FilterSection title="Financial" count={cFundCount}>
                  <TextFilterInput label="Funding Type" value={cFundingType} onChange={setCFundingType} placeholder="Series A, Seed..." />
                </FilterSection>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Estimated total from previous preview */}
            {estimatedTotal !== null && (
              <div className="flex items-center gap-2 p-2 bg-white/5 border border-white/10 rounded-lg">
                <Search className="w-4 h-4 text-white/40" />
                <span className="text-xs text-white/50">Previous estimate: ~{estimatedTotal.toLocaleString()} results</span>
              </div>
            )}

            {/* Search Button */}
            <GlassButton variant="primary" className="w-full" onClick={handleSearch}>
              <Search className="w-4 h-4 mr-1.5" />
              Search AI Arc
            </GlassButton>
          </div>
        )}

        {/* ─── Step 2: Searching ──────────────────────────────────── */}
        {step === 'searching' && (
          <div className="p-8 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-violet-400 animate-spin" />
            <p className="text-white/70 text-center">{searchStatus || 'Searching...'}</p>
            <p className="text-xs text-white/40 text-center">Large searches may take up to a minute due to rate limits</p>
            <GlassButton variant="ghost" size="sm" onClick={handleCancel}>Cancel</GlassButton>
          </div>
        )}

        {/* ─── Step 3: Results ────────────────────────────────────── */}
        {step === 'results' && (() => {
          const isCompany = searchType === 'companies';
          const items = isCompany ? companyResults : peopleResults;
          const label = isCompany ? (items.length === 1 ? 'Company' : 'Companies') : (items.length === 1 ? 'Person' : 'People');

          return (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <Check className="w-5 h-5 text-emerald-400" />
                <p className="text-sm text-emerald-400">
                  Found {items.length} {label}
                  {estimatedTotal && estimatedTotal > items.length && (
                    <span className="text-white/40"> (out of ~{estimatedTotal.toLocaleString()} total)</span>
                  )}
                </p>
              </div>

              {items.length > 0 && (
                <div className="border border-white/10 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-64">
                    <table className="w-full text-sm">
                      <thead className="bg-white/[0.03]">
                        {isCompany ? (
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Company</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Industry</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">HQ</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Staff</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Domain</th>
                          </tr>
                        ) : (
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Name</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Title</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Company</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Location</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Seniority</th>
                          </tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {isCompany
                          ? companyResults.slice(0, 20).map((c, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="px-3 py-1.5 text-white/80">{c.name}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.industry}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.headquarter_city}{c.headquarter_state ? `, ${c.headquarter_state}` : ''}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.staff_total || c.staff_range}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.domain}</td>
                              </tr>
                            ))
                          : peopleResults.slice(0, 20).map((p, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="px-3 py-1.5 text-white/80">{p.full_name || `${p.first_name} ${p.last_name}`}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.title || p.headline}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.company_name}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.location || p.city}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.seniority}</td>
                              </tr>
                            ))
                        }
                      </tbody>
                    </table>
                  </div>
                  {items.length > 20 && (
                    <p className="px-3 py-2 text-xs text-white/40 border-t border-white/10">
                      Showing 20 of {items.length} results
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <GlassButton variant="ghost" onClick={() => setStep('configure')}>Back</GlassButton>
                <GlassButton
                  variant="primary"
                  className="flex-1"
                  onClick={handleAddToTable}
                  disabled={items.length === 0}
                >
                  <UserPlus className="w-4 h-4 mr-1" />
                  Add {items.length} {label} to Table
                </GlassButton>
              </div>
            </div>
          );
        })()}
      </div>
    </Modal>
  );
}
