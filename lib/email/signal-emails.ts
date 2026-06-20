/**
 * Emails for the My Signal creator platform.
 *
 * buildSignalWelcomeEmail fires once, right after a user claims their handle for
 * the first time. It welcomes them to the FF Beacon Signal family and walks them
 * through the post-claim setup steps (in the same order as the My Signal
 * dashboard), each with a direct link. Reuses the branded light shell in ./layout.
 */

import {
  EMAIL_DISCORD_URL,
  EMAIL_SITE_URL,
  buildBrandedEmail,
  emailButton,
  emailHeading,
  emailParagraph,
  emailStepList,
  esc,
} from "./layout";

export type SignalWelcomeData = {
  /** Resolved display name, or null to fall back to a name-less greeting. */
  name: string | null;
  /** The handle they just claimed (without the leading @). */
  handle: string;
};

export function buildSignalWelcomeEmail(data: SignalWelcomeData) {
  const handle = esc(data.handle);
  const firstName = data.name ? esc(data.name.split(" ")[0]) : "";
  const hub = `${EMAIL_SITE_URL}/my-beacon/signal`;
  const link = (slug: string) => `${EMAIL_SITE_URL}/my-beacon/signal/${slug}`;
  const rankingsUrl = `${EMAIL_SITE_URL}/my-beacon/rankings`;

  const inner = `
    ${emailHeading("Welcome to the FF Beacon Signal family!")}
    ${emailParagraph(
      `${firstName ? `Congratulations, ${firstName}! ` : "Congratulations! "}You just claimed <strong>@${handle}</strong>, and that is a big first step. Welcome to My Signal, your home base on FF Beacon and the start of your creator journey with us.`,
    )}
    ${emailParagraph(
      `My Signal is one shareable page that pulls your rankings, leagues, links, and a Wall together so you can boost your signal and grow your audience. Once you publish, your public address will be <strong>ffbeacon.com/${handle}</strong>. Until then you are in full control: your profile stays private until you decide to go live.`,
    )}
    ${emailParagraph(
      "Here is your step-by-step guide. Work through it in any order, every step is optional except your handle, which you already have.",
    )}
    ${emailStepList([
      {
        title: "1. Build your identity",
        body: "Add your display name, a one-line headline, and a short bio, then pick an accent color and add an avatar and banner so the page feels like you.",
        linkLabel: "Set up identity",
        href: link("identity"),
      },
      {
        title: "2. Arrange your page",
        body: `Pick a layout and drag your blocks into the order visitors see. Tip: build your ranking boards under <a href="${rankingsUrl}" target="_blank" style="color:#7C3AED;font-weight:bold;text-decoration:none;">My Rankings</a> first, then feature them here.`,
        linkLabel: "Arrange layout",
        href: link("layout"),
      },
      {
        title: "3. Showcase what you are about",
        body: "Link your other channels, call out your favorite team and player, and feature any Sleeper leagues you have opened in League Pulse.",
        linkLabel: "Add showcase items",
        href: link("showcase"),
      },
      {
        title: "4. Post your first update",
        body: "Your Wall is where you share short updates. Visitors see them newest first, can follow you, and can react.",
        linkLabel: "Open the Wall",
        href: link("wall"),
      },
      {
        title: "5. Publish and go live",
        body: "When you are happy with it, publish your profile and choose who can see it: anyone on the web, or only you. You can switch back to draft any time.",
        linkLabel: "Publish profile",
        href: link("visibility"),
      },
    ])}
    ${emailParagraph("When you are ready, jump back in:")}
    ${emailButton("Open My Signal", hub)}
    ${emailParagraph(
      `Welcome to the family. We cannot wait to see what you build. Have a question? Just reply to this email or join us on <a href="${EMAIL_DISCORD_URL}" target="_blank" style="color:#7C3AED;font-weight:bold;text-decoration:none;">Discord</a>, our community is always happy to help.`,
    )}`;

  const text = `Welcome to the FF Beacon Signal family!

${firstName ? `Congratulations, ${data.name!.split(" ")[0]}! ` : "Congratulations! "}You just claimed @${data.handle}, and that is a big first step. Welcome to My Signal, your home base on FF Beacon and the start of your creator journey with us.

My Signal is one shareable page that pulls your rankings, leagues, links, and a Wall together so you can boost your signal and grow your audience. Once you publish, your public address will be ffbeacon.com/${data.handle}. Until then you are in full control: your profile stays private until you decide to go live.

Here is your step-by-step guide. Work through it in any order, every step is optional except your handle, which you already have.

1. Build your identity
Add your display name, headline, bio, accent color, avatar, and banner.
${link("identity")}

2. Arrange your page
Pick a layout and arrange your blocks. Tip: build ranking boards under My Rankings (${rankingsUrl}) first, then feature them here.
${link("layout")}

3. Showcase what you are about
Add links, your favorite team and player, and featured Sleeper leagues.
${link("showcase")}

4. Post your first update
Share short updates on your Wall that visitors can follow and react to.
${link("wall")}

5. Publish and go live
Publish your profile and choose who can see it.
${link("visibility")}

Open My Signal: ${hub}

Welcome to the family. We cannot wait to see what you build. Have a question? Just reply to this email or join us on Discord: ${EMAIL_DISCORD_URL}`;

  return buildBrandedEmail({
    title: "Welcome to My Signal",
    preheader:
      "Your handle is locked in. Here are the steps to build your profile and go live.",
    innerHtml: inner,
    textBody: text,
  });
}
