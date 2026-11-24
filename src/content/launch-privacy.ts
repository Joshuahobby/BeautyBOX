// Privacy notice for the launch list (DR-045). Drafted 2026-10-25 for founder review; keep
// LAUNCH_CONSENT_VERSION (src/modules/launch/launch-list.ts) in step with any change.
// {contact} is replaced with LAUNCH_LIST_CONTACT_EMAIL.

import { beautybox } from "./beautybox";

export const LAUNCH_PRIVACY = {
  title: "Launch list privacy notice",
  updated: "24 November 2026",
  sections: [
    {
      heading: "Who we are",
      paragraphs: [
        `${beautybox.registeredName} operates the BeautyBOX shop in Kigali, Rwanda, and decides why and how your launch list details are used. You can reach us at {contact}.`,
      ],
    },
    {
      heading: "What we collect",
      paragraphs: [
        "The e-mail address and/or the Rwanda mobile number you give us, the date you joined, and which version of this notice you agreed to. Nothing else is asked for.",
        "To slow down abuse, the website counts sign-ups per connection using a scrambled (keyed hash) form of your network address. It is kept apart from your details and deleted automatically within two hours.",
      ],
    },
    {
      heading: "Why, and on what basis",
      paragraphs: [
        "Only to send you one message telling you that BeautyBOX has opened: an e-mail if you gave an address, an SMS if you gave a number. We rely on your consent, which you give by ticking the box. We do not sell, share or rent your details, and we do not use them for anything else.",
      ],
    },
    {
      heading: "Where they are kept and who helps us",
      paragraphs: [
        "Your details are stored encrypted in our database, hosted by Supabase in the European Union (Ireland). Our website is hosted by Vercel, with its servers in Ireland. If you gave a phone number, the launch SMS will be sent through an SMS provider acting for us, which this notice will name before any SMS is sent. Each of these providers handles your details only on our behalf, under its data-processing terms.",
        "Because the database is outside Rwanda, your details are stored outside Rwanda. We keep them encrypted and limit access to the people who run BeautyBOX.",
      ],
    },
    {
      heading: "How long we keep them",
      paragraphs: [
        "Until we have sent the launch message, and in any case no longer than 12 months after you last signed up: after that they are deleted automatically.",
      ],
    },
    {
      heading: "Your rights",
      paragraphs: [
        "You can ask to see the details we hold, correct them, or have them deleted at any time, and you can withdraw your consent: write to {contact} and we will remove them. Withdrawing does not affect anything done before.",
        "If you are not satisfied with how we handle your data, you can complain to Rwanda's supervisory authority for personal data protection, the National Cyber Security Authority (NCSA).",
      ],
    },
  ],
} as const;
