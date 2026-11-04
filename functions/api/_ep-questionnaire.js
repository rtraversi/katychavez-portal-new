// Estate-planning client questionnaire — North Carolina wills & trusts, v1.
//
// ONE definition, used in three places (the Rondinelli lesson, kept):
//   1. the public page renders it (sent down by /api/ep-intake/public-load),
//   2. the staff Estate Planning tab renders and edits answers with it,
//   3. _ep-validate.js builds the stored payload FROM it — keys not defined here
//      can never reach the database.
//
// Every user-facing string is { en, es }. Spanish is a first draft and should get
// a native-speaker read before a client sees it (see ESTATE-INTAKE-PLAN.md).
//
// Shape
//   definition: { key, version, state, title, intro, sections[] }
//   section:    { key, title, lead?, info?, showIf?, fields[] }
//   field:      { key, type, label, hint?, required?, options?, showIf?, full? }
//   group:      { key, type:'group', label, itemLabel, addLabel, max, fields[], showIf? }
//               (a repeatable list; its value is an array of row objects. One level only.)
//
// Field types: text · textarea · email · tel · date · money · select · choice (radios)
//              · multi (checkboxes). `money` is free text ("about $250,000") on purpose —
//              approximate is fine and nothing is ever computed from it.
//
// showIf: { f:'section.field', eq|ne|in: … }  — a value elsewhere in the answers
//         { row:'field', eq|ne|in: … }         — a value in the same group row
//         an array of conditions means ALL must hold.
//
// Answers shape: { [sectionKey]: { [fieldKey]: value, [groupKey]: [ {row}, … ] } }
//
// Order inside a fiduciary group IS priority: row 1 serves, row 2 is the backup, and
// so on. There are no separate "alternate" columns (Rondinelli lesson).
//
// Who is asked what: the client PROPOSES fiduciaries here; the attorney confirms or
// edits them on the client card before anything is drafted. Nothing in this file is
// legal advice to the client, and no question decides a legal outcome on its own.

const t = (en, es) => ({ en, es });
const o = (value, en, es) => ({ value, label: t(en, es) });

const YES_NO = [o('yes', 'Yes', 'Sí'), o('no', 'No', 'No')];
const YES_NO_UNSURE = [...YES_NO, o('unsure', 'Not sure', 'No estoy seguro/a')];

// Relationship picker for people named in the plan. `spouse` matters to the merge:
// for a couple, a row marked "spouse" means "the other one of us", so the same list
// drafts both reciprocal documents (see _ep-merge-context.js).
const RELATIONSHIP = [
  o('spouse', 'My spouse', 'Mi cónyuge'),
  o('child', 'My child', 'Mi hijo/a'),
  o('parent', 'My parent', 'Mi padre/madre'),
  o('sibling', 'My brother or sister', 'Mi hermano/a'),
  o('grandchild', 'My grandchild', 'Mi nieto/a'),
  o('other_relative', 'Other relative', 'Otro familiar'),
  o('friend', 'Friend', 'Amigo/a'),
  o('other', 'Other', 'Otro'),
];

export const NC_COUNTIES = [
  'Alamance', 'Alexander', 'Alleghany', 'Anson', 'Ashe', 'Avery', 'Beaufort', 'Bertie',
  'Bladen', 'Brunswick', 'Buncombe', 'Burke', 'Cabarrus', 'Caldwell', 'Camden', 'Carteret',
  'Caswell', 'Catawba', 'Chatham', 'Cherokee', 'Chowan', 'Clay', 'Cleveland', 'Columbus',
  'Craven', 'Cumberland', 'Currituck', 'Dare', 'Davidson', 'Davie', 'Duplin', 'Durham',
  'Edgecombe', 'Forsyth', 'Franklin', 'Gaston', 'Gates', 'Graham', 'Granville', 'Greene',
  'Guilford', 'Halifax', 'Harnett', 'Haywood', 'Henderson', 'Hertford', 'Hoke', 'Hyde',
  'Iredell', 'Jackson', 'Johnston', 'Jones', 'Lee', 'Lenoir', 'Lincoln', 'Macon', 'Madison',
  'Martin', 'McDowell', 'Mecklenburg', 'Mitchell', 'Montgomery', 'Moore', 'Nash',
  'New Hanover', 'Northampton', 'Onslow', 'Orange', 'Pamlico', 'Pasquotank', 'Pender',
  'Perquimans', 'Person', 'Pitt', 'Polk', 'Randolph', 'Richmond', 'Robeson', 'Rockingham',
  'Rowan', 'Rutherford', 'Sampson', 'Scotland', 'Stanly', 'Stokes', 'Surry', 'Swain',
  'Transylvania', 'Tyrrell', 'Union', 'Vance', 'Wake', 'Warren', 'Washington', 'Watauga',
  'Wayne', 'Wilkes', 'Wilson', 'Yadkin', 'Yancey',
];

const COUNTY_OPTIONS = [
  ...NC_COUNTIES.map(c => o(c, c, c)),
  o('outside_nc', 'I live outside North Carolina', 'Vivo fuera de Carolina del Norte'),
];

const CITIZENSHIP = [
  o('us_citizen', 'U.S. citizen', 'Ciudadano/a de EE. UU.'),
  o('permanent_resident', 'Permanent resident (green card)', 'Residente permanente (green card)'),
  o('other', 'Other immigration status', 'Otro estatus migratorio'),
  o('prefer_discuss', 'I would rather discuss this in person', 'Prefiero hablarlo en persona'),
];

// A person named in the plan: the fields every fiduciary list shares.
const personFields = ({ address = false, contact = true } = {}) => [
  { key: 'name', type: 'text', required: true, label: t('Full name', 'Nombre completo') },
  { key: 'relationship', type: 'select', options: RELATIONSHIP,
    label: t('Relationship to you', 'Parentesco o relación con usted') },
  { key: 'relationship_other', type: 'text', showIf: { row: 'relationship', in: ['other', 'other_relative'] },
    label: t('Please describe the relationship', 'Describa la relación') },
  ...(address
    ? [{ key: 'address', type: 'textarea', full: true,
         label: t('Mailing address', 'Dirección postal'),
         hint: t('Street, city, state and ZIP.', 'Calle, ciudad, estado y código postal.') }]
    : [{ key: 'city_state', type: 'text', label: t('City and state where they live', 'Ciudad y estado donde vive') }]),
  ...(contact
    ? [{ key: 'phone', type: 'tel', label: t('Phone', 'Teléfono') },
       { key: 'email', type: 'email', label: t('Email', 'Correo electrónico') }]
    : []),
];

const fiduciaryGroup = (key, label, itemLabel, addLabel, opts = {}) => ({
  key, type: 'group', max: opts.max || 3, label, itemLabel, addLabel,
  fields: personFields(opts),
});

const ORDER_NOTE = t(
  'List your first choice first. Anyone after the first is a backup, in the order listed, if the person before them cannot or will not serve.',
  'Escriba primero a su primera opción. Las personas siguientes son suplentes, en el orden indicado, por si la anterior no puede o no quiere actuar.',
);

const LIVING_WILL_CHOICE = [
  o('withhold', 'I do NOT want life-prolonging measures', 'NO quiero medidas para prolongar la vida'),
  o('provide', 'I DO want life-prolonging measures', 'SÍ quiero medidas para prolongar la vida'),
  o('discuss', 'I am not sure — I want to discuss it', 'No estoy seguro/a — quiero hablarlo'),
];
const NUTRITION_CHOICE = [
  o('withhold', 'Also stop artificial food and water (tube feeding)', 'También suspender la alimentación e hidratación artificial (por sonda)'),
  o('provide', 'Continue artificial food and water', 'Continuar la alimentación e hidratación artificial'),
  o('discuss', 'I am not sure — I want to discuss it', 'No estoy seguro/a — quiero hablarlo'),
];

export const NC_ESTATE_QUESTIONNAIRE = Object.freeze({
  key: 'nc_estate',
  version: 1,
  state: 'NC',
  title: t('Estate Planning Questionnaire', 'Cuestionario de Planificación Patrimonial'),
  intro: t(
    'This questionnaire helps us prepare for your estate-planning meeting. Answer what you can — approximate is fine, and you can leave anything blank that you are unsure about. Your answers save as you go, so you can stop and come back with the same link.',
    'Este cuestionario nos ayuda a prepararnos para su reunión de planificación patrimonial. Conteste lo que pueda — los datos aproximados están bien, y puede dejar en blanco lo que no sepa. Sus respuestas se guardan a medida que avanza, así que puede pausar y regresar con el mismo enlace.',
  ),

  sections: [
    // ── 1. About you ──────────────────────────────────────────────────────────
    {
      key: 'client',
      title: t('About you', 'Sus datos'),
      lead: t('Please use your full legal name as it appears on your ID.',
              'Use su nombre legal completo tal como aparece en su identificación.'),
      fields: [
        { key: 'full_legal_name', type: 'text', required: true, full: true,
          label: t('Full legal name', 'Nombre legal completo') },
        { key: 'other_names', type: 'text', full: true,
          label: t('Other names you have used (maiden name, nicknames)', 'Otros nombres que ha usado (apellido de soltera, apodos)') },
        { key: 'dob', type: 'date', label: t('Date of birth', 'Fecha de nacimiento') },
        { key: 'phone', type: 'tel', label: t('Phone', 'Teléfono') },
        { key: 'email', type: 'email', label: t('Email', 'Correo electrónico') },
        { key: 'address', type: 'textarea', full: true,
          label: t('Home address', 'Dirección de su casa'),
          hint: t('Street, city, state and ZIP.', 'Calle, ciudad, estado y código postal.') },
        { key: 'county', type: 'select', options: COUNTY_OPTIONS,
          label: t('County you live in', 'Condado donde vive'),
          hint: t('In North Carolina, your will is handled by the Clerk of Superior Court in your county.',
                  'En Carolina del Norte, su testamento lo tramita el Secretario del Tribunal Superior de su condado.') },
        { key: 'citizenship', type: 'select', options: CITIZENSHIP,
          label: t('Citizenship', 'Ciudadanía') },
        { key: 'citizenship_country', type: 'text',
          showIf: { f: 'client.citizenship', in: ['permanent_resident', 'other'] },
          label: t('Country of citizenship', 'País de ciudadanía') },
      ],
    },

    // ── 2. Marriage ───────────────────────────────────────────────────────────
    {
      key: 'marriage',
      title: t('Marriage', 'Matrimonio'),
      fields: [
        { key: 'status', type: 'choice', required: true,
          label: t('Are you currently…', 'Actualmente usted está…'),
          options: [
            o('single', 'Single, never married', 'Soltero/a, nunca casado/a'),
            o('married', 'Married', 'Casado/a'),
            o('separated', 'Married but separated', 'Casado/a pero separado/a'),
            o('divorced', 'Divorced', 'Divorciado/a'),
            o('widowed', 'Widowed', 'Viudo/a'),
          ] },
        { key: 'spouse_name', type: 'text', full: true,
          showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t("Spouse's full legal name", 'Nombre legal completo de su cónyuge') },
        { key: 'spouse_dob', type: 'date', showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t("Spouse's date of birth", 'Fecha de nacimiento de su cónyuge') },
        { key: 'marriage_date', type: 'date', showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t('Date of marriage', 'Fecha de matrimonio') },
        { key: 'spouse_phone', type: 'tel', showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t("Spouse's phone", 'Teléfono de su cónyuge') },
        { key: 'spouse_email', type: 'email', showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t("Spouse's email", 'Correo electrónico de su cónyuge') },
        { key: 'spouse_citizenship', type: 'select', options: CITIZENSHIP,
          showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t("Spouse's citizenship", 'Ciudadanía de su cónyuge') },
        { key: 'spouse_planning', type: 'choice', options: YES_NO_UNSURE, full: true,
          showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t('Is your spouse also making an estate plan with us?', '¿Su cónyuge también hará su plan patrimonial con nosotros?') },
        { key: 'prenup', type: 'choice', options: YES_NO_UNSURE, full: true,
          showIf: { f: 'marriage.status', in: ['married', 'separated'] },
          label: t('Do you have a prenuptial or postnuptial agreement?', '¿Tienen un acuerdo prenupcial o posnupcial?') },
        { key: 'prior_marriages', type: 'choice', options: YES_NO, full: true,
          label: t('Have you (or your spouse) been married before?', '¿Usted (o su cónyuge) ha estado casado/a anteriormente?') },
        { key: 'prior_marriages_detail', type: 'textarea', full: true,
          showIf: { f: 'marriage.prior_marriages', eq: 'yes' },
          label: t('Please tell us briefly: whose marriage, to whom, and how it ended', 'Cuéntenos brevemente: de quién, con quién y cómo terminó') },
      ],
    },

    // ── 3. Children ───────────────────────────────────────────────────────────
    {
      key: 'children',
      title: t('Children', 'Hijos'),
      lead: t('Include all children — living or deceased, minor or adult, adopted, and children from other relationships.',
              'Incluya a todos sus hijos — vivos o fallecidos, menores o adultos, adoptados y de otras relaciones.'),
      fields: [
        { key: 'has_children', type: 'choice', options: YES_NO, required: true, full: true,
          label: t('Do you (or your spouse) have any children?', '¿Usted (o su cónyuge) tiene hijos?') },
        {
          key: 'list', type: 'group', max: 15, showIf: { f: 'children.has_children', eq: 'yes' },
          label: t('Children', 'Hijos'), itemLabel: t('Child', 'Hijo/a'), addLabel: t('Add a child', 'Agregar un hijo/a'),
          fields: [
            { key: 'name', type: 'text', required: true, label: t('Full name', 'Nombre completo') },
            { key: 'dob', type: 'date', label: t('Date of birth', 'Fecha de nacimiento') },
            { key: 'parentage', type: 'select', label: t('This child is…', 'Este hijo/a es…'),
              options: [
                o('ours', 'Our child together', 'Hijo/a de los dos'),
                o('mine', 'My child (not my spouse’s)', 'Hijo/a mío/a (no de mi cónyuge)'),
                o('spouses', 'My spouse’s child (not mine)', 'Hijo/a de mi cónyuge (no mío/a)'),
                o('single_parent', 'My child (I am not married)', 'Hijo/a mío/a (no estoy casado/a)'),
              ] },
            { key: 'living', type: 'select', options: [o('yes', 'Living', 'Vivo/a'), o('no', 'Deceased', 'Fallecido/a')],
              label: t('Living?', '¿Vive?') },
            { key: 'special_needs', type: 'select', options: YES_NO,
              label: t('Has a disability or receives government benefits?', '¿Tiene alguna discapacidad o recibe beneficios del gobierno?') },
            { key: 'city_state', type: 'text', label: t('City and state where they live', 'Ciudad y estado donde vive') },
          ],
        },
        { key: 'deceased_child_descendants', type: 'textarea', full: true,
          showIf: { f: 'children.has_children', eq: 'yes' },
          label: t('If any child has died, did they leave children of their own? Please list them.',
                   'Si algún hijo/a falleció, ¿dejó hijos? Por favor indíquelos.') },
      ],
    },

    // ── 4. Guardians ──────────────────────────────────────────────────────────
    {
      key: 'guardians',
      title: t('Guardian for minor children', 'Tutor para hijos menores'),
      showIf: { f: 'children.has_children', eq: 'yes' },
      lead: t('If you have children under 18, who should raise them if neither parent can? ' + ORDER_NOTE.en,
              'Si tiene hijos menores de 18 años, ¿quién debería criarlos si ninguno de los padres puede hacerlo? ' + ORDER_NOTE.es),
      fields: [
        { key: 'needed', type: 'choice', options: YES_NO, full: true,
          label: t('Do you want to name a guardian?', '¿Desea nombrar a un tutor?') },
        { ...fiduciaryGroup('list', t('Guardians', 'Tutores'), t('Guardian', 'Tutor'), t('Add a guardian', 'Agregar un tutor')),
          showIf: { f: 'guardians.needed', eq: 'yes' } },
        { key: 'not_guardian', type: 'textarea', full: true, showIf: { f: 'guardians.needed', eq: 'yes' },
          label: t('Is there anyone who should NOT be guardian? (optional)', '¿Hay alguien que NO deba ser tutor? (opcional)') },
      ],
    },

    // ── 5. Executor ───────────────────────────────────────────────────────────
    {
      key: 'executors',
      title: t('Executor', 'Albacea'),
      lead: t('Your Executor (in North Carolina, your Personal Representative) gathers what you own, pays your debts, and distributes the rest as your will says. ' + ORDER_NOTE.en,
              'Su Albacea (en Carolina del Norte, su Representante Personal) reúne sus bienes, paga sus deudas y reparte el resto según su testamento. ' + ORDER_NOTE.es),
      fields: [
        fiduciaryGroup('list', t('Executors', 'Albaceas'), t('Executor', 'Albacea'), t('Add a backup executor', 'Agregar un albacea suplente')),
        { key: 'waive_bond', type: 'choice', options: YES_NO_UNSURE, full: true,
          label: t('Should your Executor be excused from posting a bond? (A bond is a kind of insurance the court can require; most people waive it.)',
                   '¿Desea eximir a su Albacea de presentar una fianza? (La fianza es un tipo de seguro que el tribunal puede exigir; la mayoría la exime.)') },
      ],
    },

    // ── 6. Who inherits ───────────────────────────────────────────────────────
    {
      key: 'distribution',
      title: t('Who receives your property', 'Quién recibe sus bienes'),
      fields: [
        { key: 'plan', type: 'choice', required: true, full: true,
          label: t('In general, how would you like your property divided?', 'En general, ¿cómo le gustaría repartir sus bienes?'),
          options: [
            o('spouse_then_children', 'Everything to my spouse; if my spouse has died, to my children in equal shares',
              'Todo a mi cónyuge; si mi cónyuge ha fallecido, a mis hijos en partes iguales'),
            o('children_equal', 'To my children in equal shares', 'A mis hijos en partes iguales'),
            o('other', 'Something else — I will describe it below', 'Otra forma — la describo abajo'),
            o('discuss', 'I am not sure yet — I want to discuss it', 'Aún no lo sé — quiero hablarlo'),
          ] },
        {
          key: 'beneficiaries', type: 'group', max: 12, showIf: { f: 'distribution.plan', eq: 'other' },
          label: t('Beneficiaries', 'Beneficiarios'), itemLabel: t('Beneficiary', 'Beneficiario'),
          addLabel: t('Add a beneficiary', 'Agregar un beneficiario'),
          fields: [
            { key: 'name', type: 'text', required: true, label: t('Name (person or charity)', 'Nombre (persona u organización benéfica)') },
            { key: 'relationship', type: 'select', options: RELATIONSHIP, label: t('Relationship to you', 'Parentesco o relación con usted') },
            { key: 'share', type: 'text', label: t('Share (for example: 50%, or one-third)', 'Porción (por ejemplo: 50% o un tercio)') },
          ],
        },
        { key: 'plan_detail', type: 'textarea', full: true, showIf: { f: 'distribution.plan', in: ['other', 'discuss'] },
          label: t('Anything we should know about how you want things divided', 'Cualquier detalle sobre cómo quiere repartir sus bienes') },
        { key: 'young_beneficiary_age', type: 'select', full: true,
          label: t('At what age should a child or young beneficiary receive their inheritance outright? Until then it would be held for them in trust.',
                   '¿A qué edad debe un hijo o beneficiario joven recibir su herencia directamente? Hasta entonces se le guardaría en un fideicomiso.'),
          options: [o('18', '18', '18'), o('21', '21', '21'), o('25', '25', '25'), o('30', '30', '30'), o('35', '35', '35'),
                    o('staggered', 'In stages (for example, part at 25 and the rest at 30)', 'Por etapas (por ejemplo, una parte a los 25 y el resto a los 30)'),
                    o('discuss', 'I want to discuss it', 'Quiero hablarlo')] },
        {
          key: 'specific_gifts', type: 'group', max: 15,
          label: t('Specific gifts (optional) — a particular item or amount to a particular person', 'Regalos específicos (opcional) — un objeto o cantidad para una persona en particular'),
          itemLabel: t('Gift', 'Regalo'), addLabel: t('Add a gift', 'Agregar un regalo'),
          fields: [
            { key: 'item', type: 'text', required: true, label: t('Item or amount', 'Objeto o cantidad') },
            { key: 'recipient', type: 'text', label: t('Who receives it', 'Quién lo recibe') },
          ],
        },
        { key: 'backup_beneficiaries', type: 'textarea', full: true,
          label: t('If none of your family survives you, who should receive your property? (relatives, friends, charities)',
                   'Si ningún miembro de su familia le sobrevive, ¿quién debería recibir sus bienes? (familiares, amigos, organizaciones benéficas)') },
        { key: 'excluded', type: 'textarea', full: true,
          label: t('Is there anyone you intentionally want to leave out? (optional)', '¿Hay alguien a quien quiera excluir intencionalmente? (opcional)') },
        { key: 'has_pets', type: 'choice', options: YES_NO, full: true,
          label: t('Do you have pets you want provided for?', '¿Tiene mascotas que quiera dejar cuidadas?') },
        { key: 'pet_caregiver', type: 'text', full: true, showIf: { f: 'distribution.has_pets', eq: 'yes' },
          label: t('Who should care for them?', '¿Quién debería cuidarlas?') },
      ],
    },

    // ── 7. Trust ──────────────────────────────────────────────────────────────
    {
      key: 'trust',
      title: t('Revocable living trust', 'Fideicomiso en vida revocable'),
      lead: t('A revocable living trust can let your property pass without going through probate. You keep control while you are alive. You do not need to decide now.',
              'Un fideicomiso en vida revocable puede permitir que sus bienes pasen sin tramitar la sucesión. Usted mantiene el control mientras viva. No tiene que decidirlo ahora.'),
      fields: [
        { key: 'interest', type: 'choice', full: true,
          label: t('Are you interested in a revocable living trust?', '¿Le interesa un fideicomiso en vida revocable?'),
          options: [o('yes', 'Yes', 'Sí'), o('no', 'No', 'No'), o('unsure', 'Not sure — I would like to learn more', 'No estoy seguro/a — quiero saber más')] },
        { ...fiduciaryGroup('successor_trustees', t('Successor trustees', 'Fiduciarios sucesores'),
            t('Successor trustee', 'Fiduciario sucesor'), t('Add a successor trustee', 'Agregar un fiduciario sucesor')),
          showIf: { f: 'trust.interest', in: ['yes', 'unsure'] } },
        { key: 'same_as_executor', type: 'choice', options: YES_NO_UNSURE, full: true,
          showIf: { f: 'trust.interest', in: ['yes', 'unsure'] },
          label: t('Or: should your successor trustees be the same people as your Executors?', 'O bien: ¿deben sus fiduciarios sucesores ser las mismas personas que sus albaceas?') },
      ],
    },

    // ── 8. Financial power of attorney ────────────────────────────────────────
    {
      key: 'poa',
      title: t('Financial power of attorney', 'Poder notarial para asuntos financieros'),
      lead: t('Your agent can handle your money and property if you cannot — paying bills, banking, taxes, and dealing with government benefits.',
              'Su apoderado puede manejar su dinero y sus bienes si usted no puede — pagar cuentas, asuntos bancarios, impuestos y beneficios del gobierno.'),
      fields: [
        { key: 'wanted', type: 'choice', options: YES_NO_UNSURE, full: true,
          label: t('Do you want a financial power of attorney?', '¿Desea un poder notarial para asuntos financieros?') },
        { ...fiduciaryGroup('agents', t('Agents', 'Apoderados'), t('Agent', 'Apoderado'), t('Add a backup agent', 'Agregar un apoderado suplente'), { address: true }),
          showIf: { f: 'poa.wanted', in: ['yes', 'unsure'] } },
        { key: 'effective', type: 'choice', full: true, showIf: { f: 'poa.wanted', in: ['yes', 'unsure'] },
          label: t('When should it take effect?', '¿Cuándo debe entrar en vigor?'),
          options: [
            o('immediately', 'Right away', 'De inmediato'),
            o('incapacity', 'Only if I become unable to manage my own affairs', 'Solo si llego a no poder manejar mis propios asuntos'),
            o('discuss', 'I want to discuss it', 'Quiero hablarlo'),
          ] },
      ],
    },

    // ── 9. Health care ────────────────────────────────────────────────────────
    {
      key: 'health',
      title: t('Health care decisions', 'Decisiones de atención médica'),
      lead: t('Your health care agent makes medical decisions for you if you cannot make them yourself.',
              'Su representante para atención médica toma decisiones médicas por usted si usted no puede tomarlas.'),
      fields: [
        { key: 'hcpoa_wanted', type: 'choice', options: YES_NO_UNSURE, full: true,
          label: t('Do you want a health care power of attorney?', '¿Desea un poder para decisiones de atención médica?') },
        { ...fiduciaryGroup('agents', t('Health care agents', 'Representantes para atención médica'), t('Health care agent', 'Representante'),
            t('Add a backup agent', 'Agregar un representante suplente'), { address: true }),
          showIf: { f: 'health.hcpoa_wanted', in: ['yes', 'unsure'] } },
        {
          key: 'hipaa_people', type: 'group', max: 8,
          label: t('Who else may receive your medical information? (HIPAA authorization — optional)',
                   '¿Quién más puede recibir su información médica? (autorización HIPAA — opcional)'),
          itemLabel: t('Person', 'Persona'), addLabel: t('Add a person', 'Agregar una persona'),
          fields: [
            { key: 'name', type: 'text', required: true, label: t('Full name', 'Nombre completo') },
            { key: 'relationship', type: 'select', options: RELATIONSHIP, label: t('Relationship to you', 'Parentesco o relación con usted') },
          ],
        },
      ],
    },

    // ── 10. Living will ───────────────────────────────────────────────────────
    {
      key: 'living_will',
      title: t('Living will and end-of-life wishes', 'Testamento vital y deseos al final de la vida'),
      lead: t('In North Carolina this document is called an "Advance Directive for a Natural Death." These are hard questions — "I want to discuss it" is always a fine answer.',
              'En Carolina del Norte este documento se llama "Directiva Anticipada para una Muerte Natural". Son preguntas difíciles — "quiero hablarlo" siempre es una buena respuesta.'),
      fields: [
        { key: 'wanted', type: 'choice', options: YES_NO_UNSURE, full: true,
          label: t('Do you want a living will?', '¿Desea un testamento vital?') },
        { key: 'terminal', type: 'choice', options: LIVING_WILL_CHOICE, full: true,
          showIf: { f: 'living_will.wanted', in: ['yes', 'unsure'] },
          label: t('If I have an incurable or irreversible condition that will result in my death within a relatively short time…',
                   'Si tengo una condición incurable o irreversible que causará mi muerte en un plazo relativamente corto…') },
        { key: 'unconscious', type: 'choice', options: LIVING_WILL_CHOICE, full: true,
          showIf: { f: 'living_will.wanted', in: ['yes', 'unsure'] },
          label: t('If I become unconscious and my doctors determine, to a high degree of medical certainty, that I will never regain consciousness…',
                   'Si quedo inconsciente y mis médicos determinan, con un alto grado de certeza médica, que nunca recuperaré la conciencia…') },
        { key: 'dementia', type: 'choice', options: LIVING_WILL_CHOICE, full: true,
          showIf: { f: 'living_will.wanted', in: ['yes', 'unsure'] },
          label: t('If I suffer advanced dementia or another condition causing a substantial loss of my ability to think, which my doctors determine is not reversible…',
                   'Si sufro demencia avanzada u otra condición que me cause una pérdida sustancial de la capacidad de pensar, y mis médicos determinan que no es reversible…') },
        { key: 'nutrition', type: 'choice', options: NUTRITION_CHOICE, full: true,
          showIf: { f: 'living_will.wanted', in: ['yes', 'unsure'] },
          label: t('In those situations, what about artificial nutrition and hydration?', 'En esas situaciones, ¿qué desea respecto a la alimentación e hidratación artificial?') },
        { key: 'organ_donation', type: 'choice', full: true,
          label: t('Organ and tissue donation', 'Donación de órganos y tejidos'),
          options: [
            o('any', 'I wish to donate any needed organs and tissues', 'Deseo donar cualquier órgano o tejido que se necesite'),
            o('limited', 'Only certain organs or purposes (explain below)', 'Solo ciertos órganos o fines (explique abajo)'),
            o('no', 'I do not wish to donate', 'No deseo donar'),
            o('discuss', 'I want to discuss it', 'Quiero hablarlo'),
          ] },
        { key: 'remains', type: 'choice', full: true,
          label: t('Burial or cremation preference', 'Preferencia de entierro o cremación'),
          options: [
            o('burial', 'Burial', 'Entierro'),
            o('cremation', 'Cremation', 'Cremación'),
            o('repatriation', 'Return to my home country', 'Regreso a mi país de origen'),
            o('no_preference', 'No preference', 'Sin preferencia'),
          ] },
        { key: 'wishes', type: 'textarea', full: true,
          label: t('Any other wishes — religious, spiritual, or about your care or funeral (optional)',
                   'Otros deseos — religiosos, espirituales, o sobre su cuidado o funeral (opcional)') },
      ],
    },

    // ── 11. What you own ──────────────────────────────────────────────────────
    {
      key: 'assets',
      title: t('What you own', 'Sus bienes'),
      lead: t('Rough numbers are fine. This helps us choose the right plan; it is not a financial statement.',
              'Las cifras aproximadas están bien. Esto nos ayuda a elegir el plan adecuado; no es un estado financiero.'),
      fields: [
        {
          key: 'real_estate', type: 'group', max: 10,
          label: t('Real estate (your home, land, rental property)', 'Bienes raíces (su casa, terrenos, propiedades de alquiler)'),
          itemLabel: t('Property', 'Propiedad'), addLabel: t('Add a property', 'Agregar una propiedad'),
          fields: [
            { key: 'location', type: 'text', required: true, label: t('Location (city, state or country)', 'Ubicación (ciudad, estado o país)') },
            { key: 'owner', type: 'select', label: t('In whose name?', '¿A nombre de quién?'),
              options: [o('me', 'Me', 'Mío'), o('spouse', 'My spouse', 'De mi cónyuge'), o('joint', 'Jointly', 'De ambos / conjunto'),
                        o('other', 'Someone else / not sure', 'Otra persona / no sé')] },
            { key: 'value', type: 'money', label: t('Approximate value', 'Valor aproximado') },
          ],
        },
        {
          key: 'accounts', type: 'group', max: 20,
          label: t('Accounts, policies and other assets', 'Cuentas, pólizas y otros bienes'),
          itemLabel: t('Asset', 'Bien'), addLabel: t('Add an asset', 'Agregar un bien'),
          fields: [
            { key: 'kind', type: 'select', required: true, label: t('Type', 'Tipo'),
              options: [
                o('bank', 'Bank account', 'Cuenta bancaria'),
                o('retirement', 'Retirement (401(k), IRA, pension)', 'Jubilación (401(k), IRA, pensión)'),
                o('life_insurance', 'Life insurance', 'Seguro de vida'),
                o('investment', 'Investments / brokerage', 'Inversiones / corretaje'),
                o('business', 'Business you own', 'Negocio propio'),
                o('vehicle', 'Vehicle', 'Vehículo'),
                o('digital', 'Cryptocurrency / digital assets', 'Criptomonedas / bienes digitales'),
                o('foreign', 'Account or asset outside the U.S.', 'Cuenta o bien fuera de EE. UU.'),
                o('other', 'Other', 'Otro'),
              ] },
            { key: 'description', type: 'text', label: t('Where / description', 'Dónde / descripción') },
            { key: 'owner', type: 'select', label: t('In whose name?', '¿A nombre de quién?'),
              options: [o('me', 'Me', 'Mío'), o('spouse', 'My spouse', 'De mi cónyuge'), o('joint', 'Jointly', 'De ambos / conjunto'),
                        o('other', 'Someone else / not sure', 'Otra persona / no sé')] },
            { key: 'value', type: 'money', label: t('Approximate value', 'Valor aproximado') },
            { key: 'beneficiary', type: 'select', options: YES_NO_UNSURE,
              label: t('Has a named beneficiary?', '¿Tiene un beneficiario designado?') },
          ],
        },
        { key: 'total_estimate', type: 'select', full: true,
          label: t('Roughly, what is everything you own worth, minus what you owe?', 'Aproximadamente, ¿cuánto vale todo lo que tiene, menos lo que debe?'),
          options: [
            o('under_100k', 'Under $100,000', 'Menos de $100,000'),
            o('100k_500k', '$100,000 – $500,000', '$100,000 – $500,000'),
            o('500k_1m', '$500,000 – $1 million', '$500,000 – $1 millón'),
            o('1m_5m', '$1 million – $5 million', '$1 millón – $5 millones'),
            o('over_5m', 'Over $5 million', 'Más de $5 millones'),
            o('unsure', 'Not sure', 'No sé'),
          ] },
        { key: 'debts', type: 'textarea', full: true,
          label: t('Significant debts (mortgage, loans) — optional', 'Deudas importantes (hipoteca, préstamos) — opcional') },
      ],
    },

    // ── 12. Existing documents ────────────────────────────────────────────────
    {
      key: 'existing',
      title: t('Documents you already have', 'Documentos que ya tiene'),
      fields: [
        { key: 'documents', type: 'multi', full: true,
          label: t('Do you already have any of these? (check all that apply)', '¿Ya tiene alguno de estos? (marque todos los que correspondan)'),
          options: [
            o('will', 'Will', 'Testamento'),
            o('trust', 'Trust', 'Fideicomiso'),
            o('poa', 'Financial power of attorney', 'Poder notarial financiero'),
            o('hcpoa', 'Health care power of attorney', 'Poder para atención médica'),
            o('living_will', 'Living will', 'Testamento vital'),
            o('foreign_will', 'A will made in another country', 'Un testamento hecho en otro país'),
          ] },
        { key: 'details', type: 'textarea', full: true,
          label: t('When and where were they signed? Please bring copies to your meeting.',
                   '¿Cuándo y dónde se firmaron? Por favor traiga copias a su reunión.') },
      ],
    },

    // ── 13. Anything else ─────────────────────────────────────────────────────
    {
      key: 'other',
      title: t('Anything else', 'Algo más'),
      fields: [
        { key: 'concerns', type: 'textarea', full: true,
          label: t('Questions or concerns you want to talk about at your meeting', 'Preguntas o inquietudes que quiera tratar en su reunión') },
        { key: 'filled_by', type: 'text', full: true,
          label: t('If someone helped you fill this out, who? (optional)', 'Si alguien le ayudó a llenar esto, ¿quién? (opcional)') },
      ],
    },
  ],
});

// The registry of questionnaires. A second state (or a firm's own variant) is a new
// entry here; requests store the key + version they were sent with.
export const QUESTIONNAIRES = Object.freeze({
  [NC_ESTATE_QUESTIONNAIRE.key]: NC_ESTATE_QUESTIONNAIRE,
});

export function getQuestionnaire(key) {
  return QUESTIONNAIRES[key] || null;
}

export const DEFAULT_QUESTIONNAIRE_KEY = NC_ESTATE_QUESTIONNAIRE.key;
