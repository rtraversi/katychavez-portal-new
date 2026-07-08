-- Migration 1600-g1450: G-1450 field map + template registration
--
-- Authorization for Credit Card Transactions. ONLY the applicant name trio
-- is autofilled. Every credit-card / card-holder field (name-on-card, billing
-- address, card number, CVV, expiration, amount, signature) is deliberately
-- blank and must stay that way -- the portal must never store or transcribe
-- payment card data (PCI). The card holder may also be someone other than the
-- applicant.
--
-- 28 map entries (3 data-mapped, 25 deliberately blank);
-- 1 XFA barcode field(s) omitted. Field inventory: normalized/g-1450.fields.json.
-- Requires the a_number/unit_*/digits/yes_no_invert transforms shipped in
-- functions/api/_form-fill.js alongside migration 1600-g28.

UPDATE public.form_templates
SET r2_key      = 'form-templates/g-1450.pdf',
    field_count = 29,
    field_map   = '{
  "form1[0].#subform[0].FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].CCHolderMiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderAptSteFlr_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderAptSteFlr_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderAptSteFlr_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CCHolderAptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardTypeChBx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardNumber_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardNumber_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardNumber_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardNumber_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardNumber_4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].ExpirationDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardTypeChBx[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardTypeChBx[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CreditCardTypeChBx[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].SignatureOfApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].AuthorizedPaymentAmt[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'g-1450';
