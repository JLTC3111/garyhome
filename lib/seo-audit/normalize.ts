import { report } from "../seo-analysis/types.ts";
import { equivalentSeoUrls } from "../seo-analysis/url-identity.ts";
import { localizedRoute } from "../localized-routes.ts";
import { declaredPageLanguage } from "./presentation.ts";
import type { CrawlState } from "./crawler.ts";

// Stored raw audit evidence stays unchanged. This repairs its interpretation at
// the read boundary only when retained metadata proves a scanner-only defect.
export function normalizeAuditState(state: CrawlState): CrawlState {
  const note = (url: string, findingId: string, reason: string) => {
    const rows=state.classificationCorrections??=[];
    if(!rows.some(item=>item.url===url&&item.findingId===findingId&&item.reason===reason))rows.push({url,findingId,reason});
  };
  for (const page of state.pages) {
    if (!page.inspectionStatus) page.inspectionStatus = page.status > 0 ? "inspected" : page.technical.findings.some(f => /robots/.test(f.id)) ? "skipped" : "failed";
    if (page.inspectionStatus !== "inspected") {
      page.crawlError ||= state.skippedUrls.find(item => item.url === page.url)?.reason
        || page.technical.findings.find(f => f.id === "fetch-failed" || /robots/.test(f.id))?.explanation
        || "Page was not inspected. Resume or rescan to evaluate its SEO.";
      page.content = { score: null, findings: [] }; page.technical = { score: null, findings: [] };
      continue;
    }
    page.requestedLanguage ||= page.language;
    page.declaredLanguage ||= declaredPageLanguage(page);
    try {page.urlLanguage ||= localizedRoute(new URL(page.url).pathname)?.language;} catch { /* retain raw evidence */ }
    page.language=page.declaredLanguage?.split("-")[0]||page.language;
    if(page.urlLanguage&&page.declaredLanguage?.split("-")[0]===page.urlLanguage&&page.technical.findings.some(f=>f.id==="language-response")) {
      page.technical.findings=page.technical.findings.filter(f=>f.id!=="language-response");
      note(page.url,"language-response",`Scanner classification corrected: explicit ${page.urlLanguage} URL delivered declared ${page.declaredLanguage}; a conflicting requested cookie (${page.requestedLanguage}) was not a site language defect.`);
    }
    const alias=page.canonical&&equivalentSeoUrls(page.finalUrl,page.canonical,page.declaredLanguage||page.language);
    if(alias) {
      const old=page.technical.findings.find(f=>f.id==="technical-canonical-target");
      if(old){page.technical.findings=page.technical.findings.filter(f=>f.id!==old.id);note(page.url,"technical-canonical-target",`Scanner classification corrected: known UI query or legacy-language alias consolidates to ${page.canonical}; it is not a conflicting canonical target.`);}
      const self=page.hreflang?.some(alternate=>alternate.language!=="x-default"&&alternate.language.split("-")[0]===page.language&&equivalentSeoUrls(page.finalUrl,alternate.href,page.declaredLanguage||page.language));
      if(self&&page.technical.findings.some(f=>f.id==="technical-hreflang-self"&&f.severity!=="passed"))note(page.url,"technical-hreflang-self",`Scanner classification corrected: the observed alternate set contains the preferred localized self reference ${page.canonical}.`);
      if(self)page.technical.findings=page.technical.findings.map(f=>f.id==="technical-hreflang-self"?{...f,severity:"passed",title:"Language alternates include the preferred page",explanation:"The observed alternate set includes the preferred localized page for this query or legacy alias.",evidence:page.canonical}:f);
    }
    page.content = report(page.content.findings); page.technical = report(page.technical.findings);
  }
  for(const page of state.pages) {
    if(page.inspectionStatus!=="inspected")continue;
    page.technical.findings=page.technical.findings.filter(f=>{
      if(!f.id.startsWith("hreflang-reciprocal-"))return true;
      const language=f.id.slice("hreflang-reciprocal-".length),alternate=page.hreflang?.find(item=>item.language===language);
      if(!alternate)return true;
      const target=state.pages.find(item=>item.inspectionStatus==="inspected"&&(item.url===alternate.href||item.finalUrl===alternate.href)&&(language==="x-default"||(declaredPageLanguage(item)||item.language).split("-")[0]===language.split("-")[0]));
      const verified=target?.indexable&&target.hreflang?.some(item=>equivalentSeoUrls(item.href,page.canonical||page.finalUrl,page.declaredLanguage||page.language));
      if(verified)note(page.url,f.id,`Scanner classification corrected: reciprocal ${language} alternate returns to the preferred localized URL, not the filter/query request URL.`);
      return !verified;
    });
    page.technical=report(page.technical.findings);
  }
  return state;
}
