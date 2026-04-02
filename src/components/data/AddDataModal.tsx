'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, AlertCircle, Check, ChevronDown, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import type { ClaySearchFilters, ClayPerson, ClayCompanySearchFilters, ClayCompany } from '@/lib/clay-api';

interface AddDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  onComplete: () => void;
}

const SENIORITY_OPTIONS = [
  'owner', 'partner', 'c-suite', 'vp', 'director', 'head',
  'manager', 'senior', 'entry', 'assistant', 'intern', 'freelance', 'certified',
];

const JOB_FUNCTION_OPTIONS = [
  'Accounting', 'Administrative', 'Arts and Design', 'Business Development',
  'Community and Social Services', 'Consulting', 'Education', 'Engineering',
  'Entrepreneurship', 'Finance', 'Healthcare Services', 'Human Resources',
  'Information Technology', 'Legal', 'Marketing', 'Media and Communication',
  'Military and Protective Services', 'Operations', 'Product Management',
  'Program and Project Management', 'Purchasing', 'Quality Assurance',
  'Real Estate', 'Research', 'Sales', 'Support',
];

const COMPANY_SIZE_OPTIONS = [
  '1', '2-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+',
];

const PEOPLE_OUTPUT_COLUMNS = [
  { name: 'First Name', type: 'text', key: 'first_name' },
  { name: 'Last Name', type: 'text', key: 'last_name' },
  { name: 'Full Name', type: 'text', key: 'full_name' },
  { name: 'Job Title', type: 'text', key: 'job_title' },
  { name: 'Location', type: 'text', key: 'location' },
  { name: 'Company Domain', type: 'text', key: 'company_domain' },
  { name: 'LinkedIn URL', type: 'url', key: 'linkedin_url' },
];

const COMPANY_OUTPUT_COLUMNS = [
  { name: 'Company Name', type: 'text', key: 'name' },
  { name: 'Type', type: 'text', key: 'type' },
  { name: 'Size', type: 'text', key: 'size' },
  { name: 'Industry', type: 'text', key: 'industry' },
  { name: 'Country', type: 'text', key: 'country' },
  { name: 'Location', type: 'text', key: 'location' },
  { name: 'Domain', type: 'text', key: 'domain' },
  { name: 'LinkedIn URL', type: 'url', key: 'linkedin_url' },
  { name: 'Annual Revenue', type: 'text', key: 'annual_revenue' },
  { name: 'Description', type: 'text', key: 'description' },
];

const COMPANY_TYPE_OPTIONS = [
  'Privately Held', 'Public Company', 'Self Owned', 'Partnership', 'Non Profit',
];

const COMPANY_SIZE_CODE_MAP: Record<string, string> = {
  '1': '1', '2-10': '2', '11-50': '10', '51-200': '50', '201-500': '200',
  '501-1000': '500', '1001-5000': '1000', '5001-10000': '5000', '10001+': '10000',
};

// ─── Helper Components ─────────────────────────────────────────────────────

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
            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-cyan-500/20 text-cyan-400 rounded-full">
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
      <label className="text-xs text-white/40 mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Comma-separated values...'}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
      />
    </div>
  );
}

function NumberFilterInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-white/40 mb-1 block">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || ''}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender"
      />
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
              ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
              : 'bg-white/5 border-white/10 text-white/50 hover:text-white/70'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function AddDataModal({ isOpen, onClose, tableId, onComplete }: AddDataModalProps) {
  const { columns, rows, selectedRows, addColumn, fetchTable } = useTableStore();
  const abortRef = useRef<AbortController | null>(null);

  // Step state
  const [step, setStep] = useState<'configure' | 'searching' | 'results'>('configure');

  // Search type
  const [searchType, setSearchType] = useState<'people' | 'companies'>('people');

  // Domain input (people mode)
  const [domainMode, setDomainMode] = useState<'manual' | 'column'>('manual');
  const [manualDomains, setManualDomains] = useState('');
  const [domainColumnId, setDomainColumnId] = useState('');

  // Filters — text (stored as comma-separated strings, split on submit)
  const [titleKeywords, setTitleKeywords] = useState('');
  const [titleExclude, setTitleExclude] = useState('');
  const [titleMode, setTitleMode] = useState('smart');
  const [seniority, setSeniority] = useState<string[]>([]);
  const [jobFunctions, setJobFunctions] = useState<string[]>([]);
  const [jobDescKeywords, setJobDescKeywords] = useState('');

  const [countriesInclude, setCountriesInclude] = useState('');
  const [countriesExclude, setCountriesExclude] = useState('');
  const [statesInclude, setStatesInclude] = useState('');
  const [statesExclude, setStatesExclude] = useState('');
  const [citiesInclude, setCitiesInclude] = useState('');
  const [citiesExclude, setCitiesExclude] = useState('');
  const [regionsInclude, setRegionsInclude] = useState('');
  const [regionsExclude, setRegionsExclude] = useState('');

  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [industriesInclude, setIndustriesInclude] = useState('');
  const [industriesExclude, setIndustriesExclude] = useState('');
  const [companyKeywords, setCompanyKeywords] = useState('');
  const [companyKeywordsExclude, setCompanyKeywordsExclude] = useState('');

  const [headlineKeywords, setHeadlineKeywords] = useState('');
  const [aboutKeywords, setAboutKeywords] = useState('');
  const [profileKeywords, setProfileKeywords] = useState('');
  const [certKeywords, setCertKeywords] = useState('');
  const [schoolNames, setSchoolNames] = useState('');
  const [languages, setLanguages] = useState('');
  const [names, setNames] = useState('');

  const [minConnections, setMinConnections] = useState('');
  const [maxConnections, setMaxConnections] = useState('');
  const [minFollowers, setMinFollowers] = useState('');
  const [maxFollowers, setMaxFollowers] = useState('');
  const [minExperience, setMinExperience] = useState('');
  const [maxExperience, setMaxExperience] = useState('');
  const [minRoleMonths, setMinRoleMonths] = useState('');
  const [maxRoleMonths, setMaxRoleMonths] = useState('');
  const [includePast, setIncludePast] = useState(false);

  const [limit, setLimit] = useState('50');
  const [limitPerCompany, setLimitPerCompany] = useState('');

  // Company-specific filters
  const [cIndustries, setCIndustries] = useState('');
  const [cIndustriesExclude, setCIndustriesExclude] = useState('');
  const [cSizes, setCSizes] = useState<string[]>([]);
  const [cCountries, setCCountries] = useState('');
  const [cCountriesExclude, setCCountriesExclude] = useState('');
  const [cDescKeywords, setCDescKeywords] = useState('');
  const [cDescExclude, setCDescExclude] = useState('');
  const [cRevenues, setCRevenues] = useState('');
  const [cFunding, setCFunding] = useState('');
  const [cTypes, setCTypes] = useState<string[]>([]);
  const [cSemantic, setCSemantic] = useState('');
  const [cTechProducts, setCTechProducts] = useState('');
  const [cTechVendors, setCTechVendors] = useState('');
  const [cMinMembers, setCMinMembers] = useState('');
  const [cMaxMembers, setCMaxMembers] = useState('');
  const [cMinFollowers, setCMinFollowers] = useState('');
  const [cLimit, setCLimit] = useState('50');
  const [cDomains, setCDomains] = useState('');

  // Search state
  const [searchStatus, setSearchStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [peopleResults, setPeopleResults] = useState<ClayPerson[]>([]);
  const [companyResults, setCompanyResults] = useState<ClayCompany[]>([]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep('configure');
      setError(null);
      setPeopleResults([]);
      setCompanyResults([]);
      setSearchStatus('');
    }
  }, [isOpen]);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const splitCSV = (s: string): string[] => s.split(',').map(v => v.trim()).filter(Boolean);
  const toNum = (s: string): number | null => s ? Number(s) : null;

  const getDomains = (): string[] => {
    if (domainMode === 'manual') {
      return manualDomains.split(/[,\n]/).map(d => d.trim()).filter(Boolean);
    }
    if (!domainColumnId) return [];
    const unique = new Set<string>();
    for (const row of rows) {
      const cell = row.data[domainColumnId];
      const val = (cell as { value?: string | number | null })?.value?.toString().trim();
      if (val) unique.add(val);
    }
    return [...unique];
  };

  const domainCount = getDomains().length;

  const countActive = (...vals: (string | string[] | boolean)[]): number =>
    vals.reduce<number>((n, v) => {
      if (typeof v === 'boolean') return n + (v ? 1 : 0);
      if (Array.isArray(v)) return n + (v.length > 0 ? 1 : 0);
      return n + (v.trim() ? 1 : 0);
    }, 0);

  const jobCount = countActive(titleKeywords, titleExclude, seniority, jobFunctions, jobDescKeywords);
  const locationCount = countActive(countriesInclude, countriesExclude, statesInclude, statesExclude, citiesInclude, citiesExclude, regionsInclude, regionsExclude);
  const companyCount = countActive(companySizes, industriesInclude, industriesExclude, companyKeywords, companyKeywordsExclude);
  const profileCount = countActive(headlineKeywords, aboutKeywords, profileKeywords, certKeywords, schoolNames, languages, names);
  const expCount = countActive(minConnections, maxConnections, minFollowers, maxFollowers, minExperience, maxExperience, minRoleMonths, maxRoleMonths, includePast);

  // ─── Search ──────────────────────────────────────────────────────────────

  // Company filter counts
  const cIndustryCount = countActive(cIndustries, cIndustriesExclude);
  const cLocationCount = countActive(cCountries, cCountriesExclude);
  const cDescCount = countActive(cDescKeywords, cDescExclude, cSemantic);
  const cRevenueCount = countActive(cRevenues, cFunding, cTypes);
  const cTechCount = countActive(cTechProducts, cTechVendors);
  const cMemberCount = countActive(cMinMembers, cMaxMembers, cMinFollowers);

  const handleSearch = async () => {
    setStep('searching');
    setError(null);
    setSearchStatus('Starting search...');

    try {
      abortRef.current = new AbortController();
      let bodyPayload: Record<string, unknown>;

      if (searchType === 'companies') {
        const companyFilters: ClayCompanySearchFilters = {
          industries: splitCSV(cIndustries),
          industries_exclude: splitCSV(cIndustriesExclude),
          sizes: cSizes.map(s => COMPANY_SIZE_CODE_MAP[s] || s),
          country_names: splitCSV(cCountries),
          country_names_exclude: splitCSV(cCountriesExclude),
          description_keywords: splitCSV(cDescKeywords),
          description_keywords_exclude: splitCSV(cDescExclude),
          annual_revenues: splitCSV(cRevenues),
          funding_amounts: splitCSV(cFunding),
          types: cTypes,
          semantic_description: cSemantic,
          technographics_products: splitCSV(cTechProducts),
          technographics_vendors: splitCSV(cTechVendors),
          minimum_member_count: toNum(cMinMembers),
          maximum_member_count: toNum(cMaxMembers),
          minimum_follower_count: toNum(cMinFollowers),
          company_identifier: splitCSV(cDomains),
          limit: toNum(cLimit),
        };
        bodyPayload = { searchType: 'companies', filters: companyFilters };
      } else {
        const domains = getDomains();
        if (domains.length === 0) {
          setError('Enter at least one domain for people search');
          setStep('configure');
          return;
        }
        const filters: ClaySearchFilters = {
          job_title_keywords: splitCSV(titleKeywords),
          job_title_exclude_keywords: splitCSV(titleExclude),
          job_title_mode: titleMode as 'smart' | 'contain' | 'exact',
          seniority_levels: seniority,
          job_functions: jobFunctions,
          job_description_keywords: splitCSV(jobDescKeywords),
          countries_include: splitCSV(countriesInclude),
          countries_exclude: splitCSV(countriesExclude),
          states_include: splitCSV(statesInclude),
          states_exclude: splitCSV(statesExclude),
          cities_include: splitCSV(citiesInclude),
          cities_exclude: splitCSV(citiesExclude),
          regions_include: splitCSV(regionsInclude),
          regions_exclude: splitCSV(regionsExclude),
          company_sizes: companySizes,
          company_industries_include: splitCSV(industriesInclude),
          company_industries_exclude: splitCSV(industriesExclude),
          company_description_keywords: splitCSV(companyKeywords),
          company_description_keywords_exclude: splitCSV(companyKeywordsExclude),
          headline_keywords: splitCSV(headlineKeywords),
          about_keywords: splitCSV(aboutKeywords),
          profile_keywords: splitCSV(profileKeywords),
          certification_keywords: splitCSV(certKeywords),
          school_names: splitCSV(schoolNames),
          languages: splitCSV(languages),
          names: splitCSV(names),
          connection_count: toNum(minConnections),
          max_connection_count: toNum(maxConnections),
          follower_count: toNum(minFollowers),
          max_follower_count: toNum(maxFollowers),
          experience_count: toNum(minExperience),
          max_experience_count: toNum(maxExperience),
          current_role_min_months: toNum(minRoleMonths),
          current_role_max_months: toNum(maxRoleMonths),
          include_past_experiences: includePast,
          limit: toNum(limit),
          limit_per_company: toNum(limitPerCompany),
        };
        bodyPayload = { searchType: 'people', domains, filters };
      }

      const response = await fetch('/api/add-data/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Search failed' }));
        throw new Error(err.error || `Error ${response.status}`);
      }

      const data = await response.json();
      if (searchType === 'companies') {
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

  // ─── Add to Table ────────────────────────────────────────────────────────

  const handleAddToTable = async () => {
    const isCompanyMode = searchType === 'companies';
    const outputCols = isCompanyMode ? COMPANY_OUTPUT_COLUMNS : PEOPLE_OUTPUT_COLUMNS;
    const items = isCompanyMode ? companyResults : peopleResults;
    if (items.length === 0) return;

    setStep('searching');
    setSearchStatus('Adding rows to table...');

    try {
      // Create/find output columns
      const colIdMap: Record<string, string> = {};
      for (const outCol of outputCols) {
        const existing = columns.find(c => c.name.toLowerCase() === outCol.name.toLowerCase());
        if (existing) {
          colIdMap[outCol.key] = existing.id;
        } else {
          const res = await fetch('/api/columns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tableId, name: outCol.name, type: outCol.type }),
          });
          const col = await res.json();
          addColumn(col);
          colIdMap[outCol.key] = col.id;
        }
      }

      // Build rows
      const rowData = items.map(item => {
        const data: Record<string, { value: string }> = {};
        for (const outCol of outputCols) {
          const colId = colIdMap[outCol.key];
          if (colId) {
            data[colId] = { value: (item as Record<string, string>)[outCol.key] || '' };
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
          body: JSON.stringify({ tableId, rows: batch }),
        });
        setSearchStatus(`Added ${Math.min(i + BATCH_SIZE, rowData.length)} / ${rowData.length} rows...`);
      }

      await fetchTable(tableId);
      onComplete();
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

  const selectClasses = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-lavender';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Data — People Search" size="full">
      <div className="max-h-[70vh] overflow-y-auto">

        {/* ─── Step 1: Configure ──────────────────────────────────── */}
        {step === 'configure' && (
          <div className="p-4 space-y-4">
            {/* Search Type Toggle */}
            <div className="flex rounded-lg border border-white/10 overflow-hidden">
              <button type="button" onClick={() => setSearchType('people')}
                className={cn('flex-1 px-3 py-2 text-sm font-medium transition-colors border-r border-white/10',
                  searchType === 'people' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50')}>
                Find People
              </button>
              <button type="button" onClick={() => setSearchType('companies')}
                className={cn('flex-1 px-3 py-2 text-sm font-medium transition-colors',
                  searchType === 'companies' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50')}>
                Find Companies
              </button>
            </div>

            {/* People: Domain Input */}
            {searchType === 'people' && <div className="space-y-2">
              <label className="text-sm font-medium text-white/70">Company Domains</label>
              <div className="flex rounded-lg border border-white/10 overflow-hidden mb-2">
                <button
                  type="button"
                  onClick={() => setDomainMode('manual')}
                  className={cn('flex-1 px-3 py-1.5 text-xs transition-colors border-r border-white/10',
                    domainMode === 'manual' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50')}
                >
                  Type Manually
                </button>
                <button
                  type="button"
                  onClick={() => setDomainMode('column')}
                  className={cn('flex-1 px-3 py-1.5 text-xs transition-colors',
                    domainMode === 'column' ? 'bg-cyan-500/20 text-white' : 'bg-white/5 text-white/50')}
                >
                  From Column
                </button>
              </div>

              {domainMode === 'manual' ? (
                <textarea
                  value={manualDomains}
                  onChange={(e) => setManualDomains(e.target.value)}
                  placeholder="google.com, stripe.com, meta.com&#10;(one per line or comma-separated)"
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender resize-none"
                />
              ) : (
                <select value={domainColumnId} onChange={e => setDomainColumnId(e.target.value)} className={selectClasses}>
                  <option value="">Select domain column...</option>
                  {columns.filter(c => c.type !== 'enrichment').map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}

              <p className="text-xs text-white/40">
                {domainCount > 0 ? `${domainCount} domain${domainCount !== 1 ? 's' : ''} ready` : 'Enter at least one domain'}
              </p>
            </div>}

            {/* People: Results Limit */}
            {searchType === 'people' && <div className="grid grid-cols-2 gap-3">
              <NumberFilterInput label="Total Limit" value={limit} onChange={setLimit} placeholder="50" />
              <NumberFilterInput label="Per Company" value={limitPerCompany} onChange={setLimitPerCompany} placeholder="No limit" />
            </div>}

            {/* People: Filter Sections */}
            {searchType === 'people' && <div className="space-y-2">
              <p className="text-sm font-medium text-white/70">People Filters</p>

              {/* Job & Role */}
              <FilterSection title="Job & Role" count={jobCount}>
                <TextFilterInput label="Title Keywords" value={titleKeywords} onChange={setTitleKeywords} placeholder="CEO, CTO, Engineer..." />
                <TextFilterInput label="Exclude Titles" value={titleExclude} onChange={setTitleExclude} placeholder="Intern, Assistant..." />
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Title Match Mode</label>
                  <select value={titleMode} onChange={e => setTitleMode(e.target.value)} className={selectClasses}>
                    <option value="smart">Smart (default)</option>
                    <option value="contain">Contains</option>
                    <option value="exact">Exact Match</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Seniority Levels</label>
                  <CheckboxGroup options={SENIORITY_OPTIONS} selected={seniority} onChange={setSeniority} />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Job Functions</label>
                  <CheckboxGroup options={JOB_FUNCTION_OPTIONS} selected={jobFunctions} onChange={setJobFunctions} />
                </div>
                <TextFilterInput label="Job Description Keywords" value={jobDescKeywords} onChange={setJobDescKeywords} />
              </FilterSection>

              {/* Location */}
              <FilterSection title="Location" count={locationCount}>
                <TextFilterInput label="Countries (Include)" value={countriesInclude} onChange={setCountriesInclude} placeholder="United States, Germany..." />
                <TextFilterInput label="Countries (Exclude)" value={countriesExclude} onChange={setCountriesExclude} />
                <TextFilterInput label="States (Include)" value={statesInclude} onChange={setStatesInclude} placeholder="California, New York..." />
                <TextFilterInput label="States (Exclude)" value={statesExclude} onChange={setStatesExclude} />
                <TextFilterInput label="Cities (Include)" value={citiesInclude} onChange={setCitiesInclude} />
                <TextFilterInput label="Cities (Exclude)" value={citiesExclude} onChange={setCitiesExclude} />
                <TextFilterInput label="Regions (Include)" value={regionsInclude} onChange={setRegionsInclude} placeholder="EMEA, APAC, LATAM..." />
                <TextFilterInput label="Regions (Exclude)" value={regionsExclude} onChange={setRegionsExclude} />
              </FilterSection>

              {/* Company */}
              <FilterSection title="Company" count={companyCount}>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Company Size</label>
                  <CheckboxGroup options={COMPANY_SIZE_OPTIONS} selected={companySizes} onChange={setCompanySizes} />
                </div>
                <TextFilterInput label="Industries (Include)" value={industriesInclude} onChange={setIndustriesInclude} placeholder="Software Development, SaaS..." />
                <TextFilterInput label="Industries (Exclude)" value={industriesExclude} onChange={setIndustriesExclude} />
                <TextFilterInput label="Company Description Keywords" value={companyKeywords} onChange={setCompanyKeywords} />
                <TextFilterInput label="Exclude Description Keywords" value={companyKeywordsExclude} onChange={setCompanyKeywordsExclude} />
              </FilterSection>

              {/* Profile */}
              <FilterSection title="Profile" count={profileCount}>
                <TextFilterInput label="Headline Keywords" value={headlineKeywords} onChange={setHeadlineKeywords} />
                <TextFilterInput label="About Keywords" value={aboutKeywords} onChange={setAboutKeywords} />
                <TextFilterInput label="Profile Keywords" value={profileKeywords} onChange={setProfileKeywords} />
                <TextFilterInput label="Certification Keywords" value={certKeywords} onChange={setCertKeywords} />
                <TextFilterInput label="School Names" value={schoolNames} onChange={setSchoolNames} placeholder="MIT, Stanford..." />
                <TextFilterInput label="Languages" value={languages} onChange={setLanguages} placeholder="English, German..." />
                <TextFilterInput label="Names" value={names} onChange={setNames} placeholder="John, Jane..." />
              </FilterSection>

              {/* Experience & Connections */}
              <FilterSection title="Experience & Connections" count={expCount}>
                <div className="grid grid-cols-2 gap-2">
                  <NumberFilterInput label="Min Connections" value={minConnections} onChange={setMinConnections} />
                  <NumberFilterInput label="Max Connections" value={maxConnections} onChange={setMaxConnections} />
                  <NumberFilterInput label="Min Followers" value={minFollowers} onChange={setMinFollowers} />
                  <NumberFilterInput label="Max Followers" value={maxFollowers} onChange={setMaxFollowers} />
                  <NumberFilterInput label="Min Experience" value={minExperience} onChange={setMinExperience} />
                  <NumberFilterInput label="Max Experience" value={maxExperience} onChange={setMaxExperience} />
                  <NumberFilterInput label="Min Role Months" value={minRoleMonths} onChange={setMinRoleMonths} />
                  <NumberFilterInput label="Max Role Months" value={maxRoleMonths} onChange={setMaxRoleMonths} />
                </div>
                <label className="flex items-center gap-2 text-sm text-white/60 mt-2">
                  <input type="checkbox" checked={includePast} onChange={e => setIncludePast(e.target.checked)}
                    className="rounded border-white/20 bg-white/5" />
                  Include past experiences
                </label>
              </FilterSection>
            </div>}

            {/* Company: Filters */}
            {searchType === 'companies' && <>
              <div className="grid grid-cols-2 gap-3">
                <NumberFilterInput label="Result Limit" value={cLimit} onChange={setCLimit} placeholder="50" />
                <TextFilterInput label="Specific Domains (optional)" value={cDomains} onChange={setCDomains} placeholder="stripe.com, shopify.com..." />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-white/70">Company Filters</p>

                <FilterSection title="Industry" count={cIndustryCount}>
                  <TextFilterInput label="Industries" value={cIndustries} onChange={setCIndustries} placeholder="Software Development, SaaS..." />
                  <TextFilterInput label="Exclude Industries" value={cIndustriesExclude} onChange={setCIndustriesExclude} />
                </FilterSection>

                <FilterSection title="Company Size" count={countActive(cSizes)}>
                  <CheckboxGroup options={COMPANY_SIZE_OPTIONS} selected={cSizes} onChange={setCSizes} />
                </FilterSection>

                <FilterSection title="Location" count={cLocationCount}>
                  <TextFilterInput label="Countries" value={cCountries} onChange={setCCountries} placeholder="United States, Germany..." />
                  <TextFilterInput label="Exclude Countries" value={cCountriesExclude} onChange={setCCountriesExclude} />
                </FilterSection>

                <FilterSection title="Revenue & Funding" count={cRevenueCount}>
                  <TextFilterInput label="Annual Revenue Ranges" value={cRevenues} onChange={setCRevenues} placeholder="10M-25M, 25M-75M..." />
                  <TextFilterInput label="Funding Amounts" value={cFunding} onChange={setCFunding} placeholder="1M-10M, 10M-50M..." />
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">Company Types</label>
                    <CheckboxGroup options={COMPANY_TYPE_OPTIONS} selected={cTypes} onChange={setCTypes} />
                  </div>
                </FilterSection>

                <FilterSection title="Description & Semantic" count={cDescCount}>
                  <TextFilterInput label="Description Keywords" value={cDescKeywords} onChange={setCDescKeywords} />
                  <TextFilterInput label="Exclude Keywords" value={cDescExclude} onChange={setCDescExclude} />
                  <div>
                    <label className="text-xs text-white/40 mb-1 block">AI Semantic Search</label>
                    <textarea value={cSemantic} onChange={e => setCSemantic(e.target.value)}
                      placeholder="Describe the type of company you're looking for..."
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-lavender resize-none" />
                  </div>
                </FilterSection>

                <FilterSection title="Technology" count={cTechCount}>
                  <TextFilterInput label="Products / Tools" value={cTechProducts} onChange={setCTechProducts} placeholder="Salesforce, HubSpot, AWS..." />
                  <TextFilterInput label="Vendors" value={cTechVendors} onChange={setCTechVendors} placeholder="Microsoft, Google..." />
                </FilterSection>

                <FilterSection title="Employee Count" count={cMemberCount}>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberFilterInput label="Min Employees" value={cMinMembers} onChange={setCMinMembers} />
                    <NumberFilterInput label="Max Employees" value={cMaxMembers} onChange={setCMaxMembers} />
                  </div>
                  <NumberFilterInput label="Min LinkedIn Followers" value={cMinFollowers} onChange={setCMinFollowers} />
                </FilterSection>
              </div>
            </>}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <GlassButton variant="ghost" onClick={onClose}>Cancel</GlassButton>
              <GlassButton
                variant="primary"
                className="flex-1"
                onClick={handleSearch}
                disabled={searchType === 'people' && domainCount === 0}
              >
                <Search className="w-4 h-4 mr-1" />
                {searchType === 'companies'
                  ? 'Search Companies'
                  : `Search ${domainCount > 0 ? `(${domainCount} domain${domainCount !== 1 ? 's' : ''})` : ''}`
                }
              </GlassButton>
            </div>
          </div>
        )}

        {/* ─── Step 2: Searching ──────────────────────────────────── */}
        {step === 'searching' && (
          <div className="p-8 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
            <p className="text-white/70 text-center">{searchStatus || 'Searching...'}</p>
            <p className="text-xs text-white/40 text-center">This can take up to 2 minutes for large searches</p>
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
                <p className="text-sm text-emerald-400">Found {items.length} {label}</p>
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
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Country</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Size</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Revenue</th>
                          </tr>
                        ) : (
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Name</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Job Title</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Domain</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Location</th>
                          </tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {isCompany
                          ? companyResults.slice(0, 20).map((c, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="px-3 py-1.5 text-white/80">{c.name}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.industry}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.country}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.size}</td>
                                <td className="px-3 py-1.5 text-white/60">{c.annual_revenue}</td>
                              </tr>
                            ))
                          : peopleResults.slice(0, 20).map((p, i) => (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="px-3 py-1.5 text-white/80">{p.full_name || `${p.first_name} ${p.last_name}`}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.job_title}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.company_domain}</td>
                                <td className="px-3 py-1.5 text-white/60">{p.location}</td>
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
