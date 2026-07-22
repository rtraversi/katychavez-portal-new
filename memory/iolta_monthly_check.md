# IOLTA Monthly Check — July 2026
Run date: 2026-07-01

## Summary
Two confirmed rule changes found this cycle: Florida's IOTA interest rate formula (effective today, July 1, 2026) and California's bank reporting requirement (effective Jan 1, 2026, final deadline July 1, 2026). One baseline discrepancy flagged for Washington State. No other changes found across the remaining 49 states + DC.

---

## Changes Found

### 1. FLORIDA — IOTA Interest Rate Formula Change (CONFIRMED)
**What changed:** HB 893 signed into law, establishing a new mandatory interest rate formula for financial institutions holding attorney IOTA (Interest on Trust Accounts) accounts.

**New formula:**
- Rate = WSJ Prime Rate (first business day of each month) minus 300 basis points
- Floor: 0.25%
- Ceiling: 1.50%
- Financial institutions must remit interest/dividends earned to Florida Supreme Court–authorized entities for civil legal services

**Effective date:** July 1, 2026

**Prior rule:** The rate formula was based on earlier Florida Supreme Court IOTA rules (last major amendment June 18, 2021) without the explicit floor/ceiling structure. HB 893 represents a legislative override/codification of rate standards previously set only by court rule, and resolves a dispute between the Florida Bar and banking interests over what constitutes fair market return.

**Sources:**
- Florida Bar News: IOTA interest rate compromise bills move through the legislature — floridabar.org
- FL Senate Bill Analysis HB 893 (h0893z.IBS.PDF) — flsenate.gov
- FL House Committee Analysis (h0893e.COM.PDF) — flsenate.gov
- FFLA IOTA Rule page — fundingfla.org

**Schema/UI implication:** If the IurisIQ trust accounting module displays or calculates IOTA interest for FL firms, the rate calculation logic must be updated. This also affects the bank eligibility/rate-checking layer if any. Firms in FL should be prompted to verify their bank is remitting at the new formula rate.

---

### 2. CALIFORNIA — Bank Reporting to State Bar Now Active (CONFIRMED)
**What changed:** Under AB 3279 (Business and Professions Code § 6091.3) and Rules of the State Bar 2.4(D) and 2.5(E), two new obligations became effective January 1, 2026:

1. **Financial institution reporting:** Banks and credit unions holding California attorney trust accounts must electronically report attorney/licensee information to the State Bar annually (first report cycle: January 1 – March 1, 2026).
2. **Existing account deadline:** Attorneys with existing trust accounts must notify their financial institution of the Designated Licensee by **July 1, 2026** (this deadline just passed as of today's run date).

**Effective date:** January 1, 2026 (reporting); July 1, 2026 (existing-account compliance deadline)

**Relationship to baseline:** The baseline already notes "Designated Licensee required per firm (since Jan 1, 2025)" and "CTAPP since Aug 2025." This cycle's change is the *financial institution reporting layer* — banks now actively report to the State Bar rather than attorneys self-reporting only. This creates automated cross-checking of trust account compliance. It is a materially new enforcement mechanism not captured in the existing baseline.

**Sources:**
- State Bar of California CTAPP page — calbar.ca.gov
- Steph's Books: "California Mandates 'Designated Licensee' for All Trust Accounts as of January 1, 2026" — stephsbooks.com
- State Bar of California IOLTA Banking Guidelines — calbar.ca.gov
- State Bar CTAPP FAQ — info.calbar.ca.gov/knowledge/en/ctapp-faqs

**Schema/UI implication:** For California firms, the trust accounting module should display the Designated Licensee field prominently and confirm it is set. Consider adding a CA-specific compliance checklist item noting the July 1, 2026 notification-to-bank deadline. If the portal ever pulls or validates bank-side data, be aware that California banks now have a State Bar reporting obligation that could surface discrepancies.

---

## Baseline Discrepancy Flagged (Not a New Change — Verify)

### WASHINGTON STATE — Retention Period and Reconciliation Frequency
Multiple independent searches confirm Washington's RPC 1.15B (last amended February 1, 2021) requires:
- **Record retention: 7 years** (not 5 years as listed in the current baseline)
- **Reconciliation: quarterly minimum** (not monthly as listed in the current baseline)
- **Debit card/cash withdrawal restrictions**: No cash withdrawals from trust accounts; debit cards permitted only for specific client cost payments (per WSBA Advisory Opinion 2210). These restrictions are not in the baseline.

**This is NOT a new June 2026 change.** The discrepancy appears to reflect an error in the existing baseline. Recommend correcting the baseline for WA: retention → 7 years, reconciliation → quarterly minimum. No action needed in the portal unless WA-specific validation logic relies on these values.

**Sources:**
- WA Courts RPC 1.15B — courts.wa.gov
- WSBA IOLTA FAQ — wsba.org

---

## Additional Confirmed Changes

### 3. GEORGIA — Rule 1.15 Amendment Effective February 5, 2026 (CONFIRMED — DETAILS REQUIRED)
**What changed:** The Supreme Court of Georgia (order dated December 19, 2025) amended Rules 1.15(I) (Safekeeping Property – General), 1.15(II) (Safekeeping Property – Trust Account and IOLTA), and 1.15(III) (Record Keeping; Trust Account Overdraft Notification; Examination of Records), effective February 5, 2026. A further Notice of Motion to Amend was published April 1, 2026.
**Effective date:** February 5, 2026
**What is NOT yet known:** Specific content of the changes — whether retention periods, reconciliation frequency, or overdraft requirements changed — could not be extracted due to proxy restrictions on gasupreme.us and gabar.org.
**Sources:**
- gasupreme.us/rules/amendments-to-rules/
- gabar.org/general-counsel/georgia-rules-of-professional-conduct
- prod.gabar.org/home/2026/03/04/supreme-court-of-georgia-approves-amendments-to-the-rules-and-regulations (March 4, 2026 press release)
**ACTION REQUIRED:** Retrieve the full amendment text directly from the State Bar of Georgia to determine exactly what changed in each sub-rule. The fact that all three sub-rules were amended simultaneously suggests a meaningful restructuring. Baseline shows GA as 5-year retention / monthly reconciliation — this must be verified against the February 2026 amendment.
**Schema/UI implication:** Pending review — if retention or reconciliation requirements changed, GA firms in the portal need updated validation logic.

### 4. UTAH — Unclaimed Client Funds Procedure Change (Effective July 9, 2025)
**What changed:** Utah amended Rules 14-1001 and 4-1001 effective July 9, 2025. Key change: the Utah Bar Foundation may **no longer hold unclaimed client trust funds**. Within 60 days of July 9, 2025, the Foundation must transfer all previously held unclaimed client funds to the **Utah Unclaimed Property Division**. Obligations for representatives of deceased/incapacitated lawyers' estates also clarified.
**Effective date:** July 9, 2025 (pre-baseline but not in baseline)
**Sources:** legacy.utcourts.gov rules-approved/2025/07/23/, Utah Bar Foundation IOLTA page
**Schema/UI implication:** For UT firms, the portal's abandoned/unclaimed fund workflow must route to the Unclaimed Property Division, not the Utah Bar Foundation.

### 5. WEST VIRGINIA — Unclaimed IOLTA Funds Procedure (Court Order 25-161, October 2025)
**What changed:** New procedure for unclaimed/unlocatable client IOLTA funds. Under Order 25-161: amounts ≤$500 are remitted directly to the WV State Bar; amounts >$500 require a court petition after 4+ months of reasonable efforts to locate the client.
**Effective date:** October 2025 (pre-baseline, but not in current baseline)
**Source:** courtswv.gov/sites/default/pubfilesmnt/2025-10/25-161%20Order.pdf
**Schema/UI implication:** If the trust accounting module handles abandoned/unclaimed fund workflows for WV firms, the $500 threshold and WV State Bar remittance path need to be supported.

### 6. VERMONT — New 30-Day IOLTA Account Change Reporting Requirement (AO 41, July 2025)
**What changed:** Vermont Administrative Order No. 41 was amended in July 2025, adding a requirement that attorneys must report any change to their IOLTA account to the State Court Administrator within **30 days**.
**Effective date:** July 2025 (pre-baseline but not in baseline)
**Source:** vermontjudiciary.org/ao41
**Baseline impact:** Vermont currently shows only 6-year retention / monthly reconciliation. The new 30-day notification requirement is an additional compliance obligation not in the baseline.

### 7. WYOMING — Annual Opt-Out Filing Requirement Eliminated (CONFIRMED)
**What changed:** Wyoming removed the annual "Notice of Declination" requirement. Previously, attorneys who opted out of IOLTA had to file paperwork annually confirming their opt-out. That annual filing obligation has been eliminated. Wyoming remains an opt-out state — attorneys still participate unless they actively decline — but the administrative burden for opt-outs is reduced.
**Source:** wyomingbar.org trust account information page
**Baseline impact:** Minor. Wyoming remains listed as voluntary (opt-out). No change to trust accounting rules themselves.

### 8. DELAWARE — Unclaimed/Unidentifiable Trust Funds Procedure Added (Effective November 20, 2025)
**What changed:** The Delaware Supreme Court issued Order Nos. 311778 and 311788 (dated November 18, 2025), amending Rule 1.15(d)(12)(F) of the Delaware Lawyers' Rules of Professional Conduct and the Lawyers' Fund for Client Protection (LFCP) rules. This adds a new unclaimed funds procedure not previously in Delaware's framework:
1. **New remittance obligation:** If a trust fund owner cannot be identified or located after reasonable efforts, lawyers must hold the funds for **one year**, then remit them to the **Lawyers' Fund for Client Protection** (not the state unclaimed property division — distinct from other states' approaches).
2. **Two defined categories:** "Unclaimed Funds" (owner identifiable but unresponsive) vs. "Unidentifiable Funds" (owner cannot be documented after at least one year of reasonable efforts).
3. **New recordkeeping on remittance:** Lawyers must document the owner's name/last known address, date of death if applicable, efforts made to locate, amount remitted, time held, and date of remittance.
4. **Reclamation:** Owners who later surface may reclaim funds from the LFCP.
- Existing 5-year retention, monthly reconciliation, and overdraft notification requirements are **unchanged**.

**Effective date:** November 20, 2025 (pre-baseline; not in current baseline)
**Sources:**
- Delaware Supreme Court Order (LFCP Rules, No. 311778) — courts.delaware.gov/forms/download.aspx?id=311778
- Delaware Supreme Court Order (Rule 1.15, No. 311788) — courts.delaware.gov/forms/download.aspx?id=311788
- Delaware Courts — Lawyers' Fund — Unclaimed Funds — courts.delaware.gov/lfcp/unclaimed.aspx
**Schema/UI implication:** For DE firms, the trust accounting module's abandoned/unclaimed fund workflow must route to the LFCP (not state unclaimed property). The 1-year hold requirement and new recordkeeping fields need to be supported. The DE approach differs from UT (Unclaimed Property Division) and WV ($500 threshold / court petition).

---

**CORRECTION — NORTH CAROLINA:**
An earlier version of this report incorrectly listed NC as having new "random trust account audits" in Q2 2026. This was an error. The actual April 2026 development was a State Auditor **performance audit of the NC IOLTA program's grant grantee oversight** — finding that $30.3M in grants lacked adequate post-award monitoring. This does NOT affect attorney trust account rules (retention, reconciliation, etc.). The grant funding freeze (July 2025–June 30, 2026) also only affects grantmaking, not trust accounting rules. **No changes to NC attorney trust account requirements were found.** Sources: ncbar.gov, auditor.nc.gov April 21, 2026 press release.

---

## Notable Non-June Changes (Pre-Baseline / Proposed)

### ALABAMA — IOLTA Fund Recipient Change (Effective Feb 15, 2025 — Pre-Baseline)
The Alabama Supreme Court amended Rule 1.15, designating the **Alabama Law Foundation as the sole IOLTA recipient**. Previously, attorneys could direct interest to either the ALF or the Alabama Civil Justice Foundation. This was effective February 15, 2025 and should already be in the baseline. No additional changes found for June 2026.
- Source: alabamalawfoundation.org

### MICHIGAN — Proposed Rule Overhaul (Not Yet Adopted — Monitor)
ADM File No. 2022-19 proposes significant new MRPC rules: amendments to 1.15 and 1.15A, plus new 1.15B (detailed recordkeeping) and 1.15C (overdraft notification codification). Public hearing held May 21, 2025. **Not yet adopted as of research date.** If adopted, Michigan would gain an entirely new recordkeeping and overdraft-notification rule structure. Monitor Michigan courts for an adoption order.
- Source: courts.michigan.gov/proposed-orders/2022-19

### MONTANA — IOLTA Opt-Out Bill Defeated (2025 Legislative Session)
Montana SB 31 (69th Legislature, 2025) proposed making IOLTA participation voluntary (client-directed), which would have defunded civil legal aid. Committee passed 5–3 but the bill died in process on May 23, 2025, missing the general bill transmittal deadline. Montana's mandatory IOLTA program under Rule 1.18 remains unchanged. No 2026 re-introduction found.
- Sources: MTFP Capitol Tracker, Legiscan MT SB31, Montana Justice Foundation

### MINNESOTA — Administrative Governance Transfer (July 1, 2025 — Pre-Baseline)
IOLTA program oversight transferred from the Legal Services Advisory Committee to the **State Board of Civil Legal Aid (BOCLA)**. Administrative governance change only — no changes to Rule 1.15 trust accounting requirements (5-year retention, monthly reconciliation unchanged).
- Source: bocla.us/for-attorneys/minnesota-iolta-program

---

## Administrative Updates (No Rule Change)

### ILLINOIS — Administrative-Only Updates
- ARDC Client Trust Account Handbook revised January 2026 (content of revisions not yet confirmed — likely editorial, not substantive)
- LTF Safe Harbor rate updated to 2.625% effective January 2, 2026 (reflects Federal Funds Target Rate of 3.50–3.75%; this is a periodic rate update, not a rule amendment)
- ARDC bank overdraft notification list updated February 6, 2026 (new participating institutions added; the overdraft notification rule itself is unchanged)
- **Verdict:** No substantive changes to reconciliation, retention, flat fee treatment, or other tracked categories.

### VIRGINIA — 2025 Rule Updates + Baseline Discrepancy (Pre-Baseline)

**Rule 1.15 Amendment, effective July 15, 2025:** New paragraph (g) and Comments added to RPC Rule 1.15 (Safekeeping Property). The amendment links advance legal fees (flat fees and hourly prepayments) to the trust account obligation — all unearned advance fees must be held in trust until earned. Companion change: **Rule 1.5(g)** was added simultaneously, formally prohibiting nonrefundable advance legal fees (codifying what LEO 1606 had said since 1994). True retainers (paid for unavailability, not future services) are earned when paid and need not go into trust. No change to 5-year retention period or monthly reconciliation requirement. Portal implication: VA flat fee trust accounting logic must reflect Rule 1.5(g) — fees cannot be marked nonrefundable/earned-upon-receipt without a qualifying true retainer structure.

**LEO 1901, effective November 24, 2025:** Virginia became the first jurisdiction to rule that lawyers need not proportionally reduce fees when AI reduces time spent. Flat fees remain permissible even when AI reduces attorney time (departs from ABA Formal Opinion 512). Note: the November 24, 2025 Supreme Court order also amended Rule 1:15 (local courts procedural rule) — this is distinct from RPC Rule 1.15 (trust accounts).

**Baseline discrepancy — Overdraft notification:** Virginia requires trust accounts at VSB-approved institutions that have signed a Trust Account Overdraft Notification Agreement. Banks notify Bar Counsel of any overdraft or NSF. In effect since July 1, 2022 (Paragraph 20). Virginia should be added to the overdraft notification baseline list (currently lists only OH, HI, NJ, ID, NM, NV, MI).

Sources: vsb.org RPC 1.15, courts.state.va.us/amendments, VSB Paragraph 20, LEO 1901

---

## No Changes Found

The following states were searched and no IOLTA rule changes were found for June 2026:

AL, AK, AZ, AR, CO, CT, HI, ID, IL, IN, IA, KS, KY, LA, ME, MD, MA, MI, MN, MS, MO, MT, NE, NV, NH, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SC, SD, TN, TX, VA, WI, DC

*(GA, UT, VT, WY, and DE are excluded from this list — each had confirmed changes documented above.)*

---

## States Checked
All 50 states + DC were covered across 6 parallel research agents and multiple direct web searches.

**High-priority states (individually searched):** CA, NY, TX, FL, IL, PA, OH, NJ, GA, NC, VA, WA, MA, CO, AZ

**Mid-tier states (batch searched):** MN, MI, WI, MO, TN, IN, MD, SC, KY, AL, LA, CT, OK, OR, IA, MS, KS, NE, AR, NV

**Smaller states (batch searched):** WV, NM, ID, HI, MT, RI, DE, AK, VT, WY, ND, SD, NH, ME, UT, DC

---

## Additional Baseline Discrepancies Noted (Not New Changes)

Several states' actual rules appear to differ from the current baseline. These are not new June 2026 changes — they may be pre-existing errors in the baseline requiring correction:

- **Idaho (ID):** Sources indicate 6-year retention (IRPC 1.15 + Idaho Bar Commission Rules, Section XIII), not 5 years as baseline shows.
- **North Dakota (ND):** Sources indicate 6-year retention under NDRPC 1.15, not 5 years as baseline shows.
- **Montana (MT):** Montana governs IOLTA under Rule 1.18 (not Rule 1.15), which is unusual and not noted in baseline.
- **Alaska (AK):** The $100 threshold (funds that could earn more than $100 net interest must go into a separate client account) is a notable detail not in the baseline.

These should be verified against official rule texts before updating the baseline.

---

## To Monitor (Not Yet Enacted)
- **Michigan** — proposed MRPC 1.15 overhaul (ADM 2022-19) not yet adopted; public hearing May 2025
- **Montana** — SB 31 (opt-out bill) failed 2025; possible re-introduction in 2026 session
- **New Hampshire** — HB 253 would redirect IOLTA interest from civil legal aid to the NH Public Defender's office; bill status unconfirmed; NH Bar Association strongly opposing; if enacted would affect IOLTA program funding statewide
- **Georgia** — Notice of Motion to Amend Rules published April 1, 2026 suggests further Rule 1.15 changes may be pending
- **New York** — S09129 (2025-2026 session): proposed legislation to create a random audit program for law firm financial accounts and real estate escrow trust accounts; not yet enacted
- **Ohio** — Claims of "12-state mandatory three-way reconciliation" change circulating on legal vendor sites (Steph's Books, etc.) are unverified and appear to be AI-generated marketing content; no Ohio Supreme Court order corroborates them

## Action Items for Next Cycle
1. Confirm full text of VA Rule 1.15 amendment (Nov 24, 2025) — check vsb.org rule changes archive
2. Correct WA baseline: retention = 7 years, reconciliation = quarterly minimum
3. Update CA baseline to note bank reporting requirement (BPC § 6091.3) as active since Jan 2026
4. Check ARDC handbook (Rev. Jan. 2026) for any substantive IL changes not yet surfaced
5. Monitor FL IOTA rate in portal — new formula active July 1, 2026
6. **Georgia (HIGH PRIORITY):** Retrieve full text of Feb 5, 2026 Rule 1.15(I/II/III) amendments from State Bar of Georgia — access blocked this cycle (gasupreme.us, gabar.org); specific retention/reconciliation/overdraft changes unknown
7. **Idaho (VERIFY):** The Feb 2, 2026 IBCR/IRPC amendment content was inaccessible — confirm whether Section XIII (trust accounts) changed. Check isb.idaho.gov directly
8. Add DE to baseline: new unclaimed/unidentifiable funds procedure active Nov 20, 2025 (LFCP route, 1-year hold)
9. Add UT unclaimed funds change to baseline: Bar Foundation no longer accepts funds; route to Unclaimed Property Division (effective July 9, 2025)
10. Add VT 30-day IOLTA account change reporting (AO 41, July 2025) to baseline
