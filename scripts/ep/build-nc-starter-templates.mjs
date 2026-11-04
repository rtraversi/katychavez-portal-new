// Builds the North Carolina estate-planning starter Word templates.
//
//   node scripts/ep/build-nc-starter-templates.mjs                 build + verify
//   node scripts/ep/build-nc-starter-templates.mjs --check-source  also re-fetch each
//        statute from ncleg.gov and compare the template wording word-for-word
//
// Outputs
//   scripts/ep/out/<key>.docx           the template (open in Word)
//   scripts/ep/out/<key>.filled.docx    rendered against a fake, fully-populated client
//   functions/api/_ep-starter-templates.js   STARTER_TEMPLATES (base64 .docx) for the Worker
//
// The three statutory forms below are the statute text from ncleg.gov, fetched
// 2026-11-04, reproduced word for word. Only the blanks for the principal's name and
// the agents' name/address/phone carry {{placeholders}} (contract:
// functions/api/_ep-merge-context.js). Initials lines, choices, physician blanks,
// signature, witness and notary blocks are left blank on purpose: the principal
// initials and signs by hand at execution. Never pre-fill them.
//
// Layout DSL (one line = one paragraph; blank line = empty paragraph):
//   @title           centered bold 14pt
//   @c               centered
//   @h<left>,<hang>  hanging indent in pt (default 90,36): "A.\ttext"
//   @L<pt> @F<pt>    left / first-line indent in pt
//   @tabs<list>      tab stops in pt from the margin; prefix c = center, r = right
//   @box  @rule      bordered box / bottom rule
//   @pb              page break before
//   @init<N>         2-column row: N underscores over "(Initial)" | the text
//   @agent <L> <n>   NC health care agent block for hc_agent_<n>
//   <b>…</b> <i>…</i>  bold / italic.  {{tag}} is always emitted as its own run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, BorderStyle, Document, Footer, Packer, PageNumber, Paragraph, Tab,
  Table, TableCell, TableRow, TabStopType, TextRun, VerticalAlign, WidthType,
} from 'docx';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { buildEstateContext, contextKeys, BLANK } from '../../functions/api/_ep-merge-context.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(HERE, 'out');
const MODULE_OUT = path.join(ROOT, 'functions', 'api', '_ep-starter-templates.js');
const FETCHED = '2026-11-04';
const NCLEG = 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/';

// ─────────────────────────────────────────────────────────────────────────────
// Statutory text
// ─────────────────────────────────────────────────────────────────────────────

// ── G.S. 32A-25.1(a) — Health Care Power of Attorney ──
const NC_HCPOA = `@title HEALTH CARE POWER OF ATTORNEY

<b>NOTE: YOU SHOULD USE THIS DOCUMENT TO NAME A PERSON AS YOUR HEALTH CARE AGENT IF YOU ARE COMFORTABLE GIVING THAT PERSON BROAD AND SWEEPING POWERS TO MAKE HEALTH CARE DECISIONS FOR YOU. THERE IS NO LEGAL REQUIREMENT THAT ANYONE EXECUTE A HEALTH CARE POWER OF ATTORNEY.</b>

@box @box @box @box <b><i>EXPLANATION:</i></b> <i>You have the right to name someone to make health care decisions for you when you cannot make or communicate those decisions. This form may be used to create a health care power of attorney, and meets the requirements of North Carolina law. However, you are not required to use this form, and North Carolina law allows the use of other forms that meet certain requirements. If you prepare your own health care power of attorney, you should be very careful to make sure it is consistent with North Carolina law.</i>
@box @box @box @box 
@box @box @box @box <i>This document gives the person you designate as your health care agent</i> <b><i>broad powers</i></b> <i>to make health care decisions for you when you cannot make the decision yourself or cannot communicate your decision to other people. You should discuss your wishes concerning life-prolonging measures, mental health treatment, and other health care decisions with your health care agent. Except to the extent that you express specific limitations or restrictions in this form, your health care agent may make any health care decision you could make yourself.</i>
@box @box @box @box 
@box @box @box @box <i>This form does not impose a duty on your health care agent to exercise granted powers, but when a power is exercised, your health care agent will be obligated to use due care to act in your best interests and in accordance with this document.</i>
@box @box @box @box 
@box @box @box @box <i>This Health Care Power of Attorney form is intended to be valid in any jurisdiction in which it is presented, but places outside North Carolina may impose requirements that this form does not meet.</i>
@box @box @box @box 
@box @box @box @box <i>If you want to use this form, you must complete it, sign it, and have your signature witnessed</i> <i>by two qualified witnesses</i> <i>and proved by a notary public. Follow the instructions about which choices you can initial very carefully.</i> <b><i>Do not sign this form until</i></b> <i>two witnesses and a notary public are present to watch you sign it. You then should give a copy to your health care agent and to any alternates you name. You should consider filing it with the Advance Health Care Directive Registry maintained by the North Carolina Secretary of State:</i> http://www.nclifelinks.org/ahcdr/

@tabs19.8 <b>1.\tDesignation of Health Care Agent.</b>

I, {{principal_name}}, being of sound mind, hereby appoint the following person(s) to serve as my health care agent(s) to act for me and in my name (in any way I could act in person) to make health care decisions for me as authorized in this document. My designated health care agent(s) shall serve alone, in the order named.

@agent A 1

@agent B 2

@agent C 3

Any successor health care agent designated shall be vested with the same power and duties as if originally named as my health care agent, and shall serve any time his or her predecessor is not reasonably available or is unwilling or unable to serve in that capacity.

@tabs19.8 <b>2.\tEffectiveness of Appointment.</b>

My designation of a health care agent expires only when I revoke it. Absent revocation, the authority granted in this document shall become effective when and if one of the physician(s) listed below determines that I lack capacity to make or communicate decisions relating to my health care, and will continue in effect during that incapacity, or until my death, except if I authorize my health care agent to exercise my rights with respect to anatomical gifts, autopsy, or disposition of my remains, this authority will continue after my death to the extent necessary to exercise that authority.

@L54 @tabs72,234 1.\t_______________________\t<i>(Physician)</i>

@L54 @tabs72,234 2.\t_______________________\t<i>(Physician)</i>

If I have not designated a physician, or no physician(s) named above is reasonably available, the determination that I lack capacity to make or communicate decisions relating to my health care shall be made by my attending physician.

@tabs19.8 <b>3.\tRevocation.</b>

Any time while I am competent, I may revoke this power of attorney in a writing I sign or by communicating my intent to revoke, in any clear and consistent manner, to my health care agent or my health care provider.

@tabs19.8 <b>4.\tGeneral Statement of Authority Granted.</b>

Subject to any restrictions set forth in Section 5 below, I grant to my health care agent full power and authority to make and carry out all health care decisions for me. These decisions include, but are not limited to:

@h A.\tRequesting, reviewing, and receiving any information, verbal or written, regarding my physical or mental health, including, but not limited to, medical and hospital records, and to consent to the disclosure of this information.

@h B.\tEmploying or discharging my health care providers.

@h C.\tConsenting to and authorizing my admission to and discharge from a hospital, nursing or convalescent home, hospice, long-term care facility, or other health care facility.

@h D.\tConsenting to and authorizing my admission to and retention in a facility for the care or treatment of mental illness.

@h E.\tConsenting to and authorizing the administration of medications for mental health treatment and electroconvulsive treatment (ECT) commonly referred to as "shock treatment."

@h F.\tGiving consent for, withdrawing consent for, or withholding consent for, X-ray, anesthesia, medication, surgery, and all other diagnostic and treatment procedures ordered by or under the authorization of a licensed physician, dentist, podiatrist, or other health care provider. This authorization specifically includes the power to consent to measures for relief of pain.

@h G.\tAuthorizing the withholding or withdrawal of life-prolonging measures.

@h H.\tProviding my medical information at the request of any individual acting as my attorney-in-fact under a durable power of attorney or as a Trustee or successor Trustee under any Trust Agreement of which I am a Grantor or Trustee, or at the request of any other individual whom my health care agent believes should have such information. I desire that such information be provided whenever it would expedite the prompt and proper handling of my affairs or the affairs of any person or entity for which I have some responsibility. In addition, I authorize my health care agent to take any and all legal steps necessary to ensure compliance with my instructions providing access to my protected health information. Such steps shall include resorting to any and all legal procedures in and out of courts as may be necessary to enforce my rights under the law and shall include attempting to recover attorneys' fees against anyone who does not comply with this health care power of attorney.

@h I.\tTo the extent I have not already made valid and enforceable arrangements during my lifetime that have not been revoked, exercising any right I may have to authorize an autopsy or direct the disposition of my remains.

@h J.\tTaking any lawful actions that may be necessary to carry out these decisions, including, but not limited to: (i) signing, executing, delivering, and acknowledging any agreement, release, authorization, or other document that may be necessary, desirable, convenient, or proper in order to exercise and carry out any of these powers; (ii) granting releases of liability to medical providers or others; and (iii) incurring reasonable costs on my behalf related to exercising these powers, provided that this health care power of attorney shall not give my health care agent general authority over my property or financial affairs.

@tabs19.8 <b>5.\tSpecial Provisions and Limitations.</b>

(Notice: The authority granted in this document is intended to be as broad as possible so that your health care agent will have authority to make any decisions you could make to obtain or terminate any type of health care treatment or service. If you wish to limit the scope of your health care agent's powers, you may do so in this section. If none of the following are initialed, there will be no special limitations on your agent's authority.)

@h135,27 A.\tLimitations about Artificial Nutrition or Hydration: In exercising the authority to make health care decisions on my behalf, my health care agent:
@init14 @L27 shall NOT have the authority to withhold artificial nutrition (such as through tubes) OR may exercise that authority only in accordance with the following special provisions:
@L135 __________________________________________________
@L135 __________________________________________________

@init14 @L27 shall NOT have the authority to withhold artificial hydration (such as through tubes) OR may exercise that authority only in accordance with the following special provisions:
@L135 __________________________________________________
@L135 __________________________________________________
@L135 @rule <b>NOTE: If you initial either block but do not insert any special provisions, your health care agent shall have NO AUTHORITY to withhold artificial nutrition or hydration.</b>

@init14 @h27,27 B.\tLimitations Concerning Health Care Decisions. In exercising the authority to make health care decisions on my behalf, the authority of my health care agent is subject to the following special provisions: (Here you may include any specific provisions you deem appropriate such as: your own definition of when life-prolonging measures should be withheld or discontinued, or instructions to refuse any specific types of treatment that are inconsistent with your religious beliefs, or are unacceptable to you for any other reason.)
@L135 __________________________________________________
@L135 __________________________________________________
@L135 @rule <b>NOTE: DO NOT initial unless you insert a limitation.</b>

@init14 @h27,27 C.\tLimitations Concerning Mental Health Decisions. In exercising the authority to make mental health decisions on my behalf, the authority of my health care agent is subject to the following special provisions: (Here you may include any specific provisions you deem appropriate such as: limiting the grant of authority to make only mental health treatment decisions, your own instructions regarding the administration or withholding of psychotropic medications and electroconvulsive treatment (ECT), instructions regarding your admission to and retention in a health care facility for mental health treatment, or instructions to refuse any specific types of treatment that are unacceptable to you.)
@L135 __________________________________________________
@L135 __________________________________________________
@L135 @rule <b>NOTE: DO NOT initial unless you insert a limitation.</b>

@init14 @h27,27 D.\tAdvance Instruction for Mental Health Treatment. (Notice: This health care power of attorney may incorporate or be combined with an advance instruction for mental health treatment, executed in accordance with Part 2 of Article 3 of Chapter 122C of the General Statutes, which you may use to state your instructions regarding mental health treatment in the event you lack capacity to make or communicate mental health treatment decisions. Because your health care agent's decisions must be consistent with any statements you have expressed in an advance instruction, you should indicate here whether you have executed an advance instruction for mental health treatment):
@L135 __________________________________________________
@L135 __________________________________________________
@L135 @rule <b>NOTE: DO NOT initial unless you insert a limitation.</b>

@init14 @h27,27 E.\tAutopsy and Disposition of Remains. In exercising the authority to make decisions regarding autopsy and disposition of remains on my behalf, the authority of my health care agent is subject to the following special provisions and limitations. (Here you may include any specific limitations you deem appropriate such as: limiting the grant of authority and the scope of authority, or instructions regarding burial or cremation):
@L135 __________________________________________________
@L135 __________________________________________________
@L135 @rule <b>NOTE: DO NOT initial unless you insert a limitation.</b>

@tabs19.8 <b>6.\tOrgan Donation.</b>

To the extent I have not already made valid and enforceable arrangements during my lifetime that have not been revoked, my health care agent may exercise any right I may have to:

@init14 @L27 donate any needed organs or parts; or
@init14 @L27 donate only the following organs or parts:
@L135 __________________________________________________
@L135 @rule <b>NOTE: DO NOT INITIAL BOTH BLOCKS ABOVE.</b>

@init14 @L27 donate my body for anatomical study if needed.
@init14 @L27 In exercising the authority to make donations, my health care agent is subject to the following special provisions and limitations: (Here you may include any specific limitations you deem appropriate such as: limiting the grant of authority and the scope of authority, or instructions regarding gifts of the body or body parts.)
@L135 __________________________________________________
@L135 __________________________________________________
@L135 __________________________________________________

@L135 <b>NOTE: DO NOT initial unless you insert a limitation.</b>

@L63 <b>NOTE: NO AUTHORITY FOR ORGAN DONATION IS GRANTED IN THIS INSTRUMENT WITHOUT YOUR INITIALS.</b>

@tabs19.8 <b>7.\tGuardianship Provision.</b>

If it becomes necessary for a court to appoint a guardian of my person, I nominate the persons designated in Section 1, in the order named, to be the guardian of my person, to serve without bond or security. The guardian shall act consistently with G.S. 35A-1201(a)(5).

@tabs19.8 <b>8.\tReliance of Third Parties on Health Care Agent.</b>

@h A.\tNo person who relies in good faith upon the authority of or any representations by my health care agent shall be liable to me, my estate, my heirs, successors, assigns, or personal representatives, for actions or omissions in reliance on that authority or those representations.
@h B.\tThe powers conferred on my health care agent by this document may be exercised by my health care agent alone, and my health care agent's signature or action taken under the authority granted in this document may be accepted by persons as fully authorized by me and with the same force and effect as if I were personally present, competent, and acting on my own behalf. All acts performed in good faith by my health care agent pursuant to this power of attorney are done with my consent and shall have the same validity and effect as if I were present and exercised the powers myself, and shall inure to the benefit of and bind me, my estate, my heirs, successors, assigns, and personal representatives. The authority of my health care agent pursuant to this power of attorney shall be superior to and binding upon my family, relatives, friends, and others.

@tabs19.8 <b>9.\tMiscellaneous Provisions.</b>

@h A.\tRevocation of Prior Powers of Attorney. I revoke any prior health care power of attorney. The preceding sentence is not intended to revoke any general powers of attorney, some of the provisions of which may relate to health care; however, this power of attorney shall take precedence over any health care provisions in any valid general power of attorney I have not revoked.

@h B.\tJurisdiction, Severability, and Durability. This Health Care Power of Attorney is intended to be valid in any jurisdiction in which it is presented. The powers delegated under this power of attorney are severable, so that the invalidity of one or more powers shall not affect any others. This power of attorney shall not be affected or revoked by my incapacity or mental incompetence.

@h C.\tHealth Care Agent Not Liable. My health care agent and my health care agent's estate, heirs, successors, and assigns are hereby released and forever discharged by me, my estate, my heirs, successors, assigns, and personal representatives from all liability and from all claims or demands of all kinds arising out of my health care agent's acts or omissions, except for my health care agent's willful misconduct or gross negligence.

@h D.\tNo Civil or Criminal Liability. No act or omission of my health care agent, or of any other person, entity, institution, or facility acting in good faith in reliance on the authority of my health care agent pursuant to this Health Care Power of Attorney shall be considered suicide, nor the cause of my death for any civil or criminal purposes, nor shall it be considered unprofessional conduct or as lack of professional competence. Any person, entity, institution, or facility against whom criminal or civil liability is asserted because of conduct authorized by this Health Care Power of Attorney may interpose this document as a defense.

@h E.\tReimbursement. My health care agent shall be entitled to reimbursement for all reasonable expenses incurred as a result of carrying out any provision of this directive.

By signing here, I indicate that I am mentally alert and competent, fully informed as to the contents of this document, and understand the full import of this grant of powers to my health care agent.

This the _____ day of ______________, 20____.

@tabs261,r459 \t________________________(SEAL)

I hereby state that the principal, _______________, being of sound mind, signed (or directed another to sign on the principal's behalf) the foregoing health care power of attorney in my presence, and that I am not related to the principal by blood or marriage, and I would not be entitled to any portion of the estate of the principal under any existing will or codicil of the principal or as an heir under the Intestate Succession Act, if the principal died on this date without a will. I also state that I am not the principal's attending physician, nor a licensed health care provider or mental health treatment provider who is (1) an employee of the principal's attending physician or mental health treatment provider, (2) an employee of the health facility in which the principal is a patient, or (3) an employee of a nursing home or any adult care home where the principal resides. I further state that I do not have any claim against the principal or the estate of the principal.

@tabs234 Date: _____________________________\tWitness: ___________________________

@tabs234 Date: _____________________________\tWitness: ___________________________

@tabsr216,234,r459 ________________COUNTY, _________________STATE

@tabsr459 Sworn to (or affirmed) and subscribed before me this day by _____________________
@tabs315,r459 \t<i>(type/print name of signer)</i>

@tabs315,r459 \t______________________
@tabs312.3,r459 \t<i>(type/print name of witness)</i>

@tabs315,r459 \t______________________
@tabs312.3,r459 \t<i>(type/print name of witness)</i>

@tabs261 Date: ___________________________\t______________________________
@tabsc90,261 \t<i>(Official Seal)</i>\t<i>Signature of Notary Public</i>

@tabs261,r459 \t__________________, Notary Public
@tabs261,r459 \t<i>Printed or typed name</i>

@tabs261 \tMy commission expires: __________
`;

// ── G.S. 90-321(d1) — Advance Directive for a Natural Death ("Living Will") ──
const NC_LIVING_WILL = `@title ADVANCE DIRECTIVE FOR A NATURAL DEATH ("LIVING WILL")

<b>NOTE: YOU SHOULD USE THIS DOCUMENT TO GIVE YOUR HEALTH CARE PROVIDERS INSTRUCTIONS TO WITHHOLD OR WITHDRAW LIFE-PROLONGING MEASURES IN CERTAIN SITUATIONS. THERE IS NO LEGAL REQUIREMENT THAT ANYONE EXECUTE A LIVING WILL.</b>

<b><i>GENERAL INSTRUCTIONS:</i></b> <i>You can use this Advance Directive ("Living Will") form to give instructions for the future if you want your health care providers to withhold or withdraw life-prolonging measures in certain situations. You should talk to your doctor about what these terms mean. The Living Will states what choices you would have made for yourself if you were able to communicate. Talk to your family members, friends, and others you trust about your choices. Also, it is a good idea to talk with professionals such as your doctors, clergypersons, and lawyers before you complete and sign this Living Will.</i>

<i>You do not have to use this form to give those instructions, but if you create your own Advance Directive you need to be very careful to ensure that it is consistent with North Carolina law.</i>

<i>This Living Will form is intended to be valid in any jurisdiction in which it is presented, but places outside North Carolina may impose requirements that this form does not meet.</i>

<i>If you want to use this form, you must complete it, sign it, and have your signature witnessed by two qualified witnesses and proved by a notary public. Follow the instructions about which choices you can initial very carefully.</i> <b><i>Do not sign this form until</i></b> <i>two witnesses and a notary public are present to watch you sign it. You then should consider giving a copy to your primary physician and/or a trusted relative, and should consider filing it with the Advanced Health Care Directive Registry maintained by the North Carolina Secretary of State:</i> http://www.nclifelinks.org/ahcdr/

@c <b>My Desire for a Natural Death</b>

I, {{principal_name}}, being of sound mind, desire that, as specified below, my life not be prolonged by life-prolonging measures:

<b>1.\tWhen My Directives Apply</b>

\tMy directions about prolonging my life shall apply <i>IF</i> my attending physician determines that I lack capacity to make or communicate health care decisions and:

\t<b>NOTE: YOU MAY INITIAL ANY AND ALL OF THESE CHOICES.</b>

@init9 I have an incurable or irreversible condition that will result in my death within a relatively short period of time.

@init9 I become unconscious and my health care providers determine that, to a high degree of medical certainty, I will never regain my consciousness.

@init9 I suffer from advanced dementia or any other condition which results in the substantial loss of my cognitive ability and my health care providers determine that, to a high degree of medical certainty, this loss is not reversible.

<b>2.\tThese are My Directives about Prolonging My Life:</b>

\tIn those situations I have initialed in Section 1, I direct that my health care providers:

\t<b>NOTE: INITIAL ONLY IN ONE PLACE.</b>

@init9 may withhold or withdraw life-prolonging measures.

@init9 shall withhold or withdraw life-prolonging measures.

<b>3.\tExceptions - "Artificial Nutrition or Hydration"</b>

@L36 \t<b>NOTE: INITIAL ONLY IF YOU WANT TO MAKE EXCEPTIONS TO YOUR INSTRUCTIONS IN PARAGRAPH 2.</b>

\tEVEN THOUGH I do not want my life prolonged in those situations I have initialed in Section 1:
@init9 I <i>DO</i> want to receive BOTH artificial hydration AND artificial nutrition (for example, through tubes) in those situations.

@L153 <b>NOTE: DO NOT INITIAL THIS BLOCK IF ONE OF THE BLOCKS BELOW IS INITIALED.</b>

@init9 I <i>DO</i> want to receive ONLY artificial hydration (for example, through tubes) in those situations.
@L153 <b>NOTE: DO NOT INITIAL THE BLOCK ABOVE OR BELOW IF THIS BLOCK IS INITIALED.</b>

@init9 I <i>DO</i> want to receive ONLY artificial nutrition (for example, through tubes) in those situations.

@L153 <b>NOTE: DO NOT INITIAL EITHER OF THE TWO BLOCKS ABOVE IF THIS BLOCK IS INITIALED.</b>

<b>4.\tI Wish to be Made as Comfortable as Possible</b>

@L36 I direct that my health care providers take reasonable steps to keep me as clean, comfortable, and free of pain as possible so that my dignity is maintained, even though this care may hasten my death.

<b>5.\tI Understand my Advance Directive</b>

@L36 I am aware and understand that this document directs certain life-prolonging measures to be withheld or discontinued in accordance with my advance instructions.

<b>6.\tIf I have an Available Health Care Agent</b>

@L36 If I have appointed a health care agent by executing a health care power of attorney or similar instrument, and that health care agent is acting and available and gives instructions that differ from this Advance Directive, then I direct that:

@init9 Follow Advance Directive: This Advance Directive will <b>override</b> instructions my health care agent gives about prolonging my life.

@init9 Follow Health Care Agent: My health care agent has authority to <b>override</b> this Advance Directive.

@L36 <b><i>NOTE:</i></b> <b>DO NOT INITIAL BOTH BLOCKS.</b> <b><i>IF YOU DO NOT INITIAL EITHER BOX, THEN YOUR HEALTH CARE PROVIDERS WILL FOLLOW THIS ADVANCE DIRECTIVE AND IGNORE THE INSTRUCTIONS OF YOUR HEALTH CARE AGENT ABOUT PROLONGING YOUR LIFE.</i></b>

<b>7.\tMy Health Care Providers May Rely on this Directive</b>

@L36 My health care providers shall not be liable to me or to my family, my estate, my heirs, or my personal representative for following the instructions I give in this instrument. Following my directions shall not be considered suicide, or the cause of my death, or malpractice or unprofessional conduct. If I have revoked this instrument but my health care providers do not know that I have done so, and they follow the instructions in this instrument in good faith, they shall be entitled to the same protections to which they would have been entitled if the instrument had not been revoked.

<b>8.\tI Want this Directive to be Effective Anywhere</b>

@L36 \tI intend that this Advance Directive be followed by any health care provider in any place.

<b>9.\tI have the Right to Revoke this Advance Directive</b>

@L36 I understand that at any time I may revoke this Advance Directive in a writing I sign or by communicating in any clear and consistent manner my intent to revoke it to my attending physician. I understand that if I revoke this instrument I should try to destroy all copies of it.

This the ________ day of ____________, _________.

@tabs180 \t___________________________________
@tabs180 \tPrint Name __________________________

I hereby state that the declarant, ______________________, being of sound mind, signed (or directed another to sign on declarant's behalf) the foregoing Advance Directive for a Natural Death in my presence, and that I am not related to the declarant by blood or marriage, and I would not be entitled to any portion of the estate of the declarant under any existing will or codicil of the declarant or as an heir under the Intestate Succession Act, if the declarant died on this date without a will. I also state that I am not the declarant's attending physician, nor a licensed health care provider who is (1) an employee of the declarant's attending physician, (2) nor an employee of the health facility in which the declarant is a patient, or (3) an employee of a nursing home or any adult care home where the declarant resides. I further state that I do not have any claim against the declarant or the estate of the declarant.

@tabs234 Date: _____________________________\tWitness: ___________________________

@tabs234 Date: _____________________________\tWitness: ___________________________

________________COUNTY, _________________STATE

Sworn to (or affirmed) and subscribed before me this day by _____________________
@tabs301.5 \t<i>(type/print name of declarant)</i>

@tabs301.5 \t________________________
@tabs301.5 \t<i>(type/print name of witness)</i>

@tabs301.5 \t________________________
@tabs301.5 \t<i>(type/print name of witness)</i>

@tabs261 Date ___________________________\t______________________________
@tabsc90,261 \t<i>(Official Seal)</i>\t<i>Signature of Notary Public</i>

@tabs261 \t__________________, Notary Public
@tabs261 \t<i>Printed or typed name</i>

@tabs261 \tMy commission expires: _________
`;

// ── G.S. 32C-3-301 — Statutory Short Form Power of Attorney ──
const NC_POA = `@title NORTH CAROLINA
@title STATUTORY SHORT FORM POWER OF ATTORNEY
NOTICE: THE POWERS GRANTED BY THIS DOCUMENT ARE BROAD AND SWEEPING. THEY ARE DEFINED IN CHAPTER 32C OF THE NORTH CAROLINA GENERAL STATUTES, WHICH EXPRESSLY PERMITS THE USE OF ANY OTHER OR DIFFERENT FORM OF POWER OF ATTORNEY DESIRED BY THE PARTIES CONCERNED.

IMPORTANT INFORMATION

This power of attorney authorizes another person (your agent) to make decisions concerning your property for you (the principal). Your agent will be able to make decisions and act with respect to your property (including your money) whether or not you are able to act for yourself. The meaning of authority over subjects listed on this form is explained in the North Carolina Uniform Power of Attorney Act.

This power of attorney does not authorize the agent to make health care decisions for you.

You should select someone you trust to serve as your agent. Unless you specify otherwise, generally the agent's authority will continue until you die or revoke the power of attorney or the agent resigns or is unable to act for you.

Your agent is entitled to reasonable compensation unless you state otherwise in the Additional Provisions and Exclusions.

This form provides for designation of one agent, successor agent, and second successor agent. If you wish to name more than one agent, successor agent, and second successor agent, you may name a coagent, successor coagent, or second successor coagent in the Additional Provisions and Exclusions. Coagents, successor coagents, or second successor coagents are not required to act together unless you include that requirement in the Additional Provisions and Exclusions.

If your agent is unable or unwilling to act for you, your power of attorney will end unless you have named a successor agent. You may also name a second successor agent.

This power of attorney becomes effective immediately.

If you have questions about the power of attorney or the authority you are granting to your agent, you should seek legal advice before signing this form.

@c <b>DESIGNATION OF AGENT</b>
I, {{principal_name}}, name the following person as my agent:
@L72 (Name of Principal)
Name of Agent: {{poa_agent_1_name}}
@L36 {{poa_agent_1_address_inline}}
@L36 {{poa_agent_1_phone}}

@c <b>DESIGNATION OF SUCCESSOR AGENT(S)</b>
@c (OPTIONAL)

If my agent is unable or unwilling to act for me, I name as my successor agent:

Name of Successor Agent: {{poa_agent_2_name}}
@L36 {{poa_agent_2_address_inline}}
@L36 {{poa_agent_2_phone}}

If my successor agent is unable or unwilling to act for me, I name as my second successor agent:

Name of Second Successor Agent: {{poa_agent_3_name}}
@L36 {{poa_agent_3_address_inline}}
@L36 {{poa_agent_3_phone}}

INITIAL below if you want to give an agent the power to name a successor agent.

(_____) I give to my acting agent the full power to appoint another to act as my agent, and full power to revoke such appointment, if no agent named by me above is willing or able to act.

@c <b>GRANT OF GENERAL AUTHORITY</b>

I grant my agent and any successor agent general authority to act for me with respect to the following subjects as defined in the North Carolina Uniform Power of Attorney Act, Chapter 32C of the General Statutes:

(INITIAL each subject you want to include in the agent's general authority. If you wish to grant general authority over all of the subjects you may initial "All Preceding Subjects" instead of initialing each subject)

(_____) Real Property
(_____) Tangible Personal Property
(_____) Stocks and Bonds
(_____) Commodities and Options
(_____) Banks and Other Financial Institutions
(_____) Operation of Entity or Business
(_____) Insurance and Annuities
(_____) Estates, Trusts, and Other Beneficial Interests
(_____) Claims and Litigation
(_____) Personal and Family Maintenance
(_____) Benefits from Governmental Programs or Civil or Military Service
(_____) Retirement Plans
(_____) Taxes
(_____) All Preceding Subjects

@c <b>GRANT OF SPECIFIC AUTHORITY</b>
@c (OPTIONAL)

My agent MAY NOT do any of the following specific acts for me UNLESS I have INITIALED the specific authority listed below:

@F36 (CAUTION: Granting any of the following will give your agent the authority to take actions that could significantly reduce your property or change how your property is distributed at your death. INITIAL ONLY the specific authority you WANT to give your agent.)

(_____) Make a gift, subject to the limitations provided in G.S. 32C-2-217
(_____) Create or change rights of survivorship
(_____) Create or change a beneficiary designation
(_____) Authorize another person to exercise the authority granted under this power of attorney
(_____) Waive my right to be a beneficiary of a joint and survivor annuity, including a survivor benefit under a retirement plan
(_____) Exercise fiduciary powers that I have authority to delegate
(_____) Disclaim or refuse an interest in property, including a power of appointment
(_____) Access the content of electronic communications.

@c <b>EXERCISE OF SPECIFIC AUTHORITY IN FAVOR OF AGENT</b>
@c (OPTIONAL)
(_____) UNLESS INITIALED, an agent MAY NOT exercise any of the grants of specific authority initialed above in favor of the agent or an individual to whom the agent owes a legal obligation of support.

@c <b>ADDITIONAL PROVISIONS AND EXCLUSIONS</b>
@c (OPTIONAL)

(_____) __________________________________________________________________

@F36 __________________________________________________________________
@c <b>EFFECTIVE DATE</b>

This power of attorney is effective immediately.

@c <b>NOMINATION OF GUARDIAN</b>
@c (OPTIONAL)

INITIAL below ONLY if you WANT your acting agent to be your Guardian.

(_____) If it becomes necessary for a court to appoint a guardian of my estate or a general guardian, I nominate my agent acting under this power of attorney to be the guardian to serve without bond or other security.

@c <b>RELIANCE ON THIS POWER OF ATTORNEY</b>

Any person, including my agent, may rely upon the validity of this power of attorney or a copy of it unless that person knows it has terminated or is invalid.

@c <b>MEANING AND EFFECT</b>

The meaning and effect of this power of attorney shall for all purposes be determined by the law of the State of North Carolina.

@c <b>SIGNATURE AND ACKNOWLEDGMENT</b>

@tabs288 _________________________________\t___________________________
@tabs324 @F54 Your Signature\tDate

_________________________________
Your Name Printed

State of __________________________, County of ________________________.

I certify that the following person personally appeared before me this day, acknowledging to me that he or she signed the foregoing document: __________________________________.

@tabs288 Date: _____________________________\t____________________________
@F306 Signature of Notary Public
(Official Seal)
@F216 ___________________________, Notary Public
@F234 Printed or typed name
@F198 My commission expires:______________________

@pb @c <b>IMPORTANT INFORMATION FOR AGENT</b>

<b>Agent's Duties</b>

When you accept the authority granted under this power of attorney, a special legal relationship is created between you and the principal. This relationship imposes upon you legal duties that continue until you resign or your authority is terminated or the power of attorney is terminated or revoked. You must:

@h (1)\tDo what you know the principal reasonably expects you to do with the principal's property or, if you do not know the principal's expectations, act in the principal's best interest;
@h (2)\tAct in good faith;
@h (3)\tDo nothing beyond the authority granted in this power of attorney; and
@h (4)\tDisclose your identity as an agent whenever you act for the principal by writing or printing the name of the principal and signing your own name as "agent" in the following manner: (Principal's Name) by (Your Signature) as Agent.

Unless the Additional Provisions and Exclusions in this power of attorney state otherwise, you must also:

@h (1)\tAct loyally for the principal's benefit;
@h (2)\tAvoid conflicts that would impair your ability to act in the principal's best interest;
@h (3)\tAct with care, competence, and diligence;
@h (4)\tKeep a record of all receipts, disbursements, and transactions made on behalf of the principal;
@h (5)\tCooperate with any person that has authority to make health care decisions for the principal to do what you know the principal reasonably expects, or if you do not know the principal's expectations, to act in the principal's best interest; and
@h (6)\tAttempt to preserve the principal's estate plan if you know the plan and preserving the plan is consistent with the principal's best interest.

<b>Termination of Agent's Authority</b>

You must stop acting on behalf of the principal if you learn of any event that terminated or revoked this power of attorney or your authority under this power of attorney. Events that terminate a power of attorney or your authority to act under a power of attorney include:

@h (1)\tDeath of a principal;
@h (2)\tThe principal's revocation of the power of attorney or the termination of your authority;
@h (3)\tThe occurrence of a termination event stated in the power of attorney;
@h (4)\tThe purpose of the power of attorney is fully accomplished; or
@h (5)\tIf you are married to the principal, your divorce from the principal, unless the Additional Provisions and Exclusions in this power of attorney state that your divorce from the principal will not terminate your authority.

<b>Liability of Agent</b>

The meaning of the authority granted to you is defined in the North Carolina Uniform Power of Attorney Act. If you violate the North Carolina Uniform Power of Attorney Act or act outside the authority granted, you may be liable for any damages caused by your violation.

If there is anything about this document or your duties that you do not understand, you should seek legal advice.
`;

// ── HIPAA authorization (NOT a statutory form — drafted for 45 CFR 164.508(c)) ──
const HIPAA = `@title AUTHORIZATION FOR USE AND DISCLOSURE OF PROTECTED HEALTH INFORMATION
@c (HIPAA Authorization)

Name: {{principal_name}}
Date of Birth: {{principal_dob_long}}
Address: {{principal_address_inline}}

<b>1.\tWho may disclose my information.</b> I, {{principal_name}}, authorize every physician, health care professional, dentist, hospital, clinic, laboratory, pharmacy, nursing home, home health agency, health plan, insurer, health care clearinghouse, and other covered entity or health care provider that has provided or is providing treatment or services to me, or that has paid for or is seeking payment for such services, to disclose my protected health information as described in this authorization.

<b>2.\tWho may receive my information.</b> My protected health information may be disclosed to each of the following persons, and to any person then serving as my health care agent under a health care power of attorney I have signed:
{{#hc_agents}}
@L36 {{name}}
{{/hc_agents}}
{{#has_hipaa_people}}
@L36 {{hipaa_people_list}}
{{/has_hipaa_people}}
{{^has_hc_agent_1}}
{{^has_hipaa_people}}
@L36 __________
{{/has_hipaa_people}}
{{/has_hc_agent_1}}

<b>3.\tInformation to be disclosed.</b> All of my protected health information, including my complete medical records and any information about my diagnosis, treatment, prognosis, medications, test results, and payment for health care, whether past, present, or future. This includes information about mental health conditions, treatment for substance use disorders, HIV/AIDS, sexually transmitted diseases, and genetic testing, to the extent that information may lawfully be disclosed under this authorization. This authorization does not cover psychotherapy notes.

<b>4.\tPurpose.</b> This disclosure is made at my request. Its purpose is to allow the persons named above to receive information about my health and health care, to talk with my health care providers, and to help with my care and with health care, insurance, and financial matters on my behalf.

<b>5.\tEffective date and expiration.</b> This authorization is effective immediately and does not depend on my being incapacitated. It expires two (2) years after my death, unless I revoke it earlier.

<b>6.\tMy right to revoke.</b> I may revoke this authorization at any time by giving written notice of revocation to the health care provider or health plan that holds my information. A revocation does not apply to information already disclosed, or to any action a provider or plan has already taken in reliance on this authorization. Each provider's or plan's Notice of Privacy Practices describes how to revoke an authorization.

<b>7.\tNo condition on treatment.</b> A health care provider or health plan may not condition my treatment, payment, enrollment, or eligibility for benefits on whether I sign this authorization.

<b>8.\tRedisclosure.</b> Information disclosed under this authorization may be redisclosed by the person who receives it and may no longer be protected by the federal privacy rules.

<b>9.\tCopies.</b> A photocopy, facsimile, or electronic copy of this authorization is as valid as the original. I am entitled to receive a copy of this authorization after I sign it.

<b>10.\tOther documents.</b> This authorization is separate from, and does not limit, any authority I have given in a health care power of attorney or other document.


@tabs288 _________________________________\t____________________
@tabs288 {{principal_name}}\tDate

If signed by a personal representative of the individual named above, describe the representative's authority to act for the individual: ______________________________________________
`;

const TEMPLATES = [
  {
    key: 'nc_hcpoa',
    name: 'Health Care Power of Attorney (NC statutory form)',
    description: 'N.C.G.S. 32A-25.1 statutory form, verbatim. Fills the principal and up to three health care agents (name, address, phone). Every initials line, physician, signature, witness and notary blank is left for execution.',
    statute: 'N.C.G.S. § 32A-25.1',
    source_url: `${NCLEG}Chapter_32A/GS_32A-25.1.html`,
    statutory: true,
    dsl: NC_HCPOA,
    // Wording check against the live statute (--check-source): first/last words of the form.
    source: { start: 'HEALTH CARE POWER OF ATTORNEY', end: 'My commission expires', drop: [] },
    expect: (f) => [f.principal, ...f.hc.flatMap(a => [a.name, a.phone, a.addressInline])],
  },
  {
    key: 'nc_living_will',
    name: 'Advance Directive for a Natural Death — Living Will (NC statutory form)',
    description: 'N.C.G.S. 90-321(d1) statutory form, verbatim (current version from S.L. 2007-502). Fills the declarant\'s name only; the declarant initials every choice by hand at signing. Signature, witness and notary blocks blank.',
    statute: 'N.C.G.S. § 90-321(d1)',
    source_url: `${NCLEG}Chapter_90/GS_90-321.html`,
    statutory: true,
    dsl: NC_LIVING_WILL,
    source: { start: 'ADVANCE DIRECTIVE FOR A NATURAL DEATH', end: 'My commission expires', drop: [] },
    expect: (f) => [f.principal],
  },
  {
    key: 'nc_poa',
    name: 'Statutory Short Form Power of Attorney (NC)',
    description: 'N.C.G.S. 32C-3-301 statutory form, verbatim, including the Important Information for Agent page. Fills the principal, agent and two successor agents. Every initial-the-subject line, Additional Provisions, signature and notary acknowledgment is left blank.',
    statute: 'N.C.G.S. § 32C-3-301',
    source_url: `${NCLEG}Chapter_32C/GS_32C-3-301.html`,
    statutory: true,
    dsl: NC_POA,
    // The statute wraps the form in quotation marks ("NORTH CAROLINA … advice.") and
    // opens the agent page with another; those marks belong to the statute, not the form.
    source: { start: '"NORTH CAROLINA', end: 'seek legal advice.', drop: ['"NORTH', '"IMPORTANT', 'advice."'] },
    expect: (f) => [f.principal, ...f.poa.flatMap(a => [a.name, a.phone, a.addressInline])],
  },
  {
    key: 'nc_hipaa',
    name: 'HIPAA Authorization',
    description: 'NOT a statutory form — attorney review required. Plain HIPAA authorization drafted to contain the core elements of 45 CFR 164.508(c). Lists the health care agents and the HIPAA people from the questionnaire.',
    statute: '45 CFR 164.508 (not a North Carolina statutory form)',
    source_url: 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.508',
    statutory: false,
    dsl: HIPAA,
    source: null,
    expect: (f) => [f.principal, f.dobLong, ...f.hc.map(a => a.name), ...f.hipaa],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DSL → docx
// ─────────────────────────────────────────────────────────────────────────────

const TW = 20;                       // twips per point
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const LINE = { style: BorderStyle.SINGLE, size: 6, space: 4, color: '000000' };
const DIRECTIVE = /^@(title|tabs|init|agent|box|rule|pb|c|h|L|F)(\S*)\s?/;

function parseLine(line) {
  const o = { text: line, tabs: [] };
  let m;
  while ((m = DIRECTIVE.exec(o.text))) {
    const [, d, arg] = m;
    o.text = o.text.slice(m[0].length);
    if (d === 'tabs') {
      o.tabs = arg.split(',').map(t => {
        const type = t[0] === 'c' ? TabStopType.CENTER : t[0] === 'r' ? TabStopType.RIGHT : TabStopType.LEFT;
        return { type, position: Math.round(parseFloat(t.replace(/^[cr]/, '')) * TW) };
      });
    } else if (d === 'h') {
      const [left, hang] = arg ? arg.split(',').map(Number) : [90, 36];
      o.left = left; o.hanging = hang;
    } else if (d === 'L') o.left = Number(arg);
    else if (d === 'F') o.firstLine = Number(arg);
    else if (d === 'init') o.init = Number(arg);
    else o[d] = arg || true;
  }
  return o;
}

// Inline markup → runs. Every {{tag}} is its own run, so docxtemplater never sees a
// tag split across runs.
function runs(text, base = {}) {
  const out = [];
  let bold = !!base.bold, italics = !!base.italics;
  for (const tok of text.split(/(<\/?[bi]>|\{\{[^}]*\}\}|\t)/)) {
    if (!tok) continue;
    if (tok === '<b>') bold = true;
    else if (tok === '</b>') bold = !!base.bold;
    else if (tok === '<i>') italics = true;
    else if (tok === '</i>') italics = !!base.italics;
    else if (tok === '\t') out.push(new TextRun({ children: [new Tab()], bold, italics, size: base.size }));
    else out.push(new TextRun({ text: tok, bold, italics, size: base.size }));
  }
  return out;
}

function para(o, extra = {}) {
  const prose = o.text.length > 80 && !o.text.includes('\t') && !/_{5}/.test(o.text);
  const indent = {};
  if (o.left) indent.left = o.left * TW;
  if (o.hanging) indent.hanging = o.hanging * TW;
  if (o.firstLine) indent.firstLine = o.firstLine * TW;
  return new Paragraph({
    alignment: o.title || o.c ? AlignmentType.CENTER : prose ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    indent: Object.keys(indent).length ? indent : undefined,
    tabStops: o.tabs.length ? o.tabs : (o.hanging ? [{ type: TabStopType.LEFT, position: o.left * TW }] : undefined),
    border: o.box ? { top: LINE, bottom: LINE, left: LINE, right: LINE } : o.rule ? { bottom: LINE } : undefined,
    pageBreakBefore: !!o.pb,
    keepNext: !!o.title,
    children: runs(o.text, o.title ? { bold: true, size: 28 } : {}),
    ...extra,
  });
}

const cell = (children, widthTw) => new TableCell({
  children, width: { size: widthTw, type: WidthType.DXA }, borders: NO_BORDERS,
  verticalAlign: VerticalAlign.TOP,
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
});
const table = (rows, widths) => new Table({
  rows, columnWidths: widths, width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  borders: NO_BORDERS,
});

// "______  shall NOT have …" over "(Initial)": a borderless two-column row, so the text
// wraps in its own column the way the statute lays it out.
function initRow(o) {
  const LEFT = 108 * TW, RIGHT = 468 * TW - LEFT;
  const left = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('_'.repeat(o.init))] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(Initial)', italics: true })] }),
  ];
  const right = [para({ ...o, init: undefined }, { alignment: AlignmentType.JUSTIFIED })];
  return table([new TableRow({ cantSplit: true, children: [cell(left, LEFT), cell(right, RIGHT)] })], [LEFT, RIGHT]);
}

// G.S. 32A-25.1 §1 agent block, same labels and order as the statute, with the
// contract's name/address/phone in the blanks. The questionnaire collects one phone
// number, which goes on the statute's first telephone line (Home Telephone).
function agentBlock(letter, n) {
  const LEFT = 266 * TW, RIGHT = 468 * TW - LEFT;
  const rows = [
    [`${letter}.\tName: {{hc_agent_${n}_name}}`, `Home Telephone: {{hc_agent_${n}_phone}}`],
    [`Home Address: {{hc_agent_${n}_address_inline}}`, 'Work Telephone: _______________'],
    ['____________________________________', 'Cellular Telephone: _______________'],
  ];
  // keepNext on the first two rows keeps each agent's block on one page
  const p = (t, i) => para(parseLine(t), { keepNext: i < 2, keepLines: true });
  return table(rows.map(([l, r], i) => new TableRow({ cantSplit: true, children: [cell([p(l, i)], LEFT), cell([p(r, i)], RIGHT)] })),
    [LEFT, RIGHT]);
}

function blocks(dsl) {
  const out = [];
  for (const line of dsl.replace(/\n$/, '').split('\n')) {
    if (line.trim() === '') { out.push(new Paragraph({ children: [] })); continue; }
    const o = parseLine(line);
    if (o.agent) { const [L, n] = o.text.trim().split(/\s+/); out.push(agentBlock(L, Number(n))); }
    else if (o.init) out.push(initRow(o));
    else out.push(para(o));
  }
  return out;
}

async function buildDocx(t) {
  const doc = new Document({
    creator: 'IurisIQ',
    title: t.name,
    subject: t.statute,
    description: t.statutory ? `Statutory form text from ${t.source_url} (fetched ${FETCHED})` : 'Not a statutory form - attorney review required',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { after: 0, line: 240 } } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 18 })] })] }) },
      children: blocks(t.dsl),
    }],
  });
  return normalizeZip(await Packer.toBuffer(doc));
}

// Same input → same bytes: pin the zip entry dates and the core.xml timestamps, so a
// rebuild without wording changes doesn't churn the generated module.
function normalizeZip(buf) {
  const src = new PizZip(buf);
  const out = new PizZip();
  const date = new Date(`${FETCHED}T00:00:00Z`);
  for (const name of Object.keys(src.files).sort()) {
    const f = src.files[name];
    if (f.dir) continue;
    let data = f.asUint8Array();
    if (name === 'docProps/core.xml') {
      data = f.asText().replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, `$1${FETCHED}T00:00:00Z`);
    }
    out.file(name, data, { date, binary: typeof data !== 'string' });
  }
  return out.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&sect;/g, '§')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

function docXml(buf, bodyOnly = false) {
  const zip = new PizZip(buf);
  const re = bodyOnly ? /^word\/document\.xml$/ : /^word\/(document|header\d*|footer\d*)\.xml$/;
  return Object.keys(zip.files).filter(n => re.test(n))
    .map(n => zip.file(n).asText()).join('');
}
function docText(buf, bodyOnly = false) {
  return decode(docXml(buf, bodyOnly).replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ''));
}

function render(buf, ctx) {
  const doc = new Docxtemplater(new PizZip(buf), {
    paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' },
    nullGetter: (part) => (part.module ? '' : BLANK),       // same as functions/api/ep-draft.js
  });
  doc.render(ctx);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const FIX = {
  principal: 'Maria Elena Lopez', dob: '1968-03-14', dobLong: 'March 14, 1968',
  hc: [
    { name: 'Jorge Luis Lopez', relationship: 'spouse', address: '1200 Oberlin Road\nApt 4B\nRaleigh, NC 27605', phone: '(919) 555-0102' },
    { name: 'Carmen Ruiz Ortega', relationship: 'sibling', address: '77 Glenwood Avenue\nRaleigh, NC 27603', phone: '(919) 555-0177' },
    { name: 'Sofia Isabel Lopez', relationship: 'child', address: '55 Elm Street\nDurham, NC 27701', phone: '(984) 555-0155' },
  ],
  poa: [
    { name: 'Jorge Luis Lopez', relationship: 'spouse', address: '1200 Oberlin Road\nApt 4B\nRaleigh, NC 27605', phone: '(919) 555-0102' },
    { name: 'Daniel Reyes Castillo', relationship: 'friend', address: '8 Pine Court\nCary, NC 27513', phone: '(919) 555-0188' },
    { name: 'Teresa Gomez Vidal', relationship: 'other_relative', relationship_other: 'my cousin', address: '410 Lake Drive\nApex, NC 27502', phone: '(919) 555-0199' },
  ],
  hipaa: ['Ana Lucia Lopez', 'Rosa Martinez Diaz'],
};
for (const a of [...FIX.hc, ...FIX.poa]) a.addressInline = a.address.split('\n').join(', ');

const FIXTURE_ANSWERS = {
  client: { full_legal_name: FIX.principal, dob: FIX.dob, phone: '(919) 555-0101', email: 'maria.lopez@example.com',
    address: '1200 Oberlin Road\nApt 4B\nRaleigh, NC 27605', county: 'Wake' },
  marriage: { status: 'married', spouse_name: 'Jorge Luis Lopez', spouse_dob: '1965-07-02',
    spouse_phone: '(919) 555-0102', spouse_email: 'jorge.lopez@example.com' },
  children: { list: [{ name: 'Ana Lucia Lopez', dob: '1994-09-21' }, { name: 'Sofia Isabel Lopez', dob: '1997-01-30' }] },
  executors: { list: [{ name: 'Jorge Luis Lopez', relationship: 'spouse', city_state: 'Raleigh, NC' }] },
  guardians: { list: [] },
  trust: { successor_trustees: [] },
  poa: { agents: FIX.poa.map(({ addressInline, ...r }) => r) },
  health: {
    agents: FIX.hc.map(({ addressInline, ...r }) => r),
    hipaa_people: [{ name: FIX.hipaa[0], relationship: 'child' }, { name: FIX.hipaa[1], relationship: 'friend' }],
  },
};

const underscoreRuns = (s) => {
  const m = {};
  for (const r of s.match(/_+/g) || []) m[r.length] = (m[r.length] || 0) + 1;
  return m;
};

function verify(t, buf) {
  const errs = [];
  const xml = docXml(buf);
  const text = docText(buf);
  const keys = contextKeys();

  // 1. every tag sits inside one <w:t>, and every key is in the contract
  for (const m of xml.matchAll(/\{\{/g)) {
    const rest = xml.slice(m.index, m.index + 200);
    const close = rest.indexOf('}}');
    if (close < 0 || rest.slice(0, close).includes('<')) errs.push(`tag split across runs near ${JSON.stringify(rest.slice(0, 60))}`);
  }
  const tags = [...text.matchAll(/\{\{([^}]*)\}\}/g)].map(m => m[1].trim());
  for (const tag of tags) {
    const key = tag.replace(/^[#^/]/, '').trim();
    if (!keys.has(key)) errs.push(`tag {{${tag}}} is not in contextKeys()`);
  }

  // 2. fully-populated render
  const ctx = buildEstateContext({ answers: FIXTURE_ANSWERS, firmName: 'Example Law PLLC', attorneyName: 'A. Attorney',
    now: new Date(`${FETCHED}T12:00:00Z`) });
  let filled;
  try { filled = render(buf, ctx); } catch (e) { errs.push(`render(fixture) threw: ${e.message} ${JSON.stringify(e.properties?.errors?.map(x => x.properties?.explanation) || '')}`); }
  if (filled) {
    fs.writeFileSync(path.join(OUT_DIR, `${t.key}.filled.docx`), filled);
    const ftext = docText(filled);
    if (ftext.includes('{{') || ftext.includes('}}')) errs.push('fixture render left a {{ or }}');
    for (const want of t.expect(FIX)) if (!ftext.includes(want)) errs.push(`fixture render is missing "${want}"`);
    // no tag fell back to BLANK: the filled doc has no underscore line the template lacked
    const before = underscoreRuns(text.replace(/\{\{[^}]*\}\}/g, ''));
    const after = underscoreRuns(ftext);
    for (const [len, n] of Object.entries(after)) if (n > (before[len] || 0)) errs.push(`fixture render has an extra ${len}-underscore blank (a tag rendered empty?)`);
    // initials lines are never touched
    const count = (s, re) => (s.match(re) || []).length;
    for (const re of [/\(Initial\)/g, /\(_____\)/g]) {
      if (count(text, re) !== count(ftext, re)) errs.push(`initials lines changed by rendering (${re})`);
    }
  }

  // 3. empty context renders cleanly
  try {
    const empty = docText(render(buf, buildEstateContext({})));
    if (empty.includes('{{')) errs.push('empty render left a {{');
  } catch (e) { errs.push(`render(empty) threw: ${e.message}`); }

  return { errs, tags: [...new Set(tags)] };
}

// --check-source: the template's words, minus placeholders and blanks, must equal the
// statute's words, minus blanks. "(Initial)" captions move with the two-column layout,
// so they're compared by count rather than position.
async function checkSource(t, buf) {
  const res = await fetch(t.source_url);
  if (!res.ok) return [`fetch ${t.source_url} → HTTP ${res.status}`];
  const html = await res.text();
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => decode(m[1].replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')));
  const start = paras.findIndex(p => p.trim().startsWith(t.source.start));
  const endFrom = paras.findIndex((p, i) => i > start && p.includes(t.source.end) &&
    paras.slice(i + 1).every(q => !q.includes(t.source.end)));
  if (start < 0 || endFrom < 0) return [`could not locate the form in ${t.source_url}`];
  let srcText = paras.slice(start, endFrom + 1).join(' ');
  srcText = srcText.slice(0, srcText.lastIndexOf(t.source.end) + t.source.end.length + 1);
  const words = (s) => s.split(/\s+/).map(w => w.replace(/_+/g, '')).filter(w => w && w !== '(Initial)');
  const drop = new Map(t.source.drop.map(d => [d, d.replace(/"/g, '')]));
  const src = words(srcText).map(w => drop.get(w) ?? w);
  const tpl = words(docText(buf, true).replace(/\{\{[^}]*\}\}/g, ' '));
  const errs = [];
  const n = Math.max(src.length, tpl.length);
  for (let i = 0; i < n; i++) {
    if (src[i] !== tpl[i]) {
      errs.push(`wording differs at word ${i}: statute "${src.slice(Math.max(0, i - 6), i + 6).join(' ')}" vs template "${tpl.slice(Math.max(0, i - 6), i + 6).join(' ')}"`);
      break;
    }
  }
  const ic = (s) => (s.match(/\(Initial\)/g) || []).length;
  if (ic(srcText) !== ic(docText(buf))) errs.push(`"(Initial)" count: statute ${ic(srcText)}, template ${ic(docText(buf))}`);
  return errs.length ? errs : [`OK — ${src.length} words match`].map(s => ({ ok: s }));
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const checkSrc = process.argv.includes('--check-source');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let failed = false;
  const manifest = [];

  for (const t of TEMPLATES) {
    const buf = await buildDocx(t);
    fs.writeFileSync(path.join(OUT_DIR, `${t.key}.docx`), buf);
    const { errs, tags } = verify(t, buf);
    console.log(`\n${t.key}  (${buf.length} bytes)  tags: ${tags.join(' ')}`);
    if (checkSrc && t.source) {
      for (const r of await checkSource(t, buf)) {
        if (typeof r === 'string') errs.push(r); else console.log(`  source check: ${r.ok}`);
      }
    }
    if (errs.length) { failed = true; for (const e of errs) console.log(`  FAIL ${e}`); }
    else console.log('  PASS: contract tags, fixture render, empty render');
    manifest.push({
      key: t.key, name: t.name, description: t.description, statute: t.statute,
      source_url: t.source_url, fetched: t.statutory ? FETCHED : null, statutory: t.statutory,
      base64: buf.toString('base64'),
    });
  }

  const header = `// GENERATED by scripts/ep/build-nc-starter-templates.mjs — do not edit by hand.
// NC estate-planning starter templates (.docx, base64). The statutory forms reproduce
// the statute text from ncleg.gov verbatim (fetched ${FETCHED}); see scripts/ep/README.md.
// Imports nothing, so the Worker can bundle it as-is.
`;
  fs.writeFileSync(MODULE_OUT, `${header}\nexport const STARTER_TEMPLATES = ${JSON.stringify(manifest, null, 2)};\n`);
  console.log(`\nwrote ${path.relative(ROOT, MODULE_OUT)} and scripts/ep/out/*.docx`);
  if (failed) { console.log('\nVERIFICATION FAILED'); process.exit(1); }
  console.log('all templates verified');
}

main().catch((e) => { console.error(e); process.exit(1); });
