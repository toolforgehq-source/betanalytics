const BRAND_COLOR = '#3b82f6'
const ACCENT_COLOR = '#22d3ee'
const BG_COLOR = '#0f172a'
const CARD_BG = '#1e293b'
const TEXT_COLOR = '#e2e8f0'
const MUTED_COLOR = '#94a3b8'

function emailWrapper(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_COLOR};padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <span style="font-size:20px;font-weight:700;color:white;">BetAnalytics.ai</span>
              <br>
              <span style="font-size:12px;color:${MUTED_COLOR};">Elo-Powered Sports Betting Intelligence</span>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CARD_BG};border-radius:16px;padding:32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="font-size:12px;color:${MUTED_COLOR};margin:0;">
                BetAnalytics.ai provides entertainment and educational content only.<br>
                Gambling involves risk. Never bet more than you can afford to lose.<br>
                Must be 21+. If you or someone you know has a gambling problem, call 1-800-GAMBLER.
              </p>
              <p style="font-size:12px;color:${MUTED_COLOR};margin:16px 0 0 0;">
                <a href="https://betanalytics.ai" style="color:${MUTED_COLOR};text-decoration:underline;">betanalytics.ai</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(text: string, url: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td align="center">
        <a href="${url}" style="display:inline-block;padding:14px 32px;background:linear-gradient(to right,${BRAND_COLOR},${ACCENT_COLOR});color:white;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`
}

export function welcomeEmail(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hey ${name}` : 'Hey there'
  return {
    subject: 'Welcome to BetAnalytics.ai - Here\'s how to find your edge',
    html: emailWrapper(`
      <h1 style="color:white;font-size:24px;margin:0 0 16px 0;">${greeting}, welcome to BetAnalytics.ai</h1>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        You now have access to the same type of mathematical edge that professional bettors use: an independent Elo rating system that calculates probabilities the market might be missing.
      </p>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;font-weight:600;">
        Here's what you can do right now:
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:${ACCENT_COLOR};font-size:16px;">1.</td>
          <td style="padding:8px 0;color:${TEXT_COLOR};font-size:16px;line-height:1.5;">
            <strong style="color:white;">Ask about any matchup</strong> — "What's the edge on tonight's Lakers game?" and get back Elo-based probabilities with full transparency.
          </td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:${ACCENT_COLOR};font-size:16px;">2.</td>
          <td style="padding:8px 0;color:${TEXT_COLOR};font-size:16px;line-height:1.5;">
            <strong style="color:white;">See injury adjustments</strong> — We automatically quantify injury impacts using real-time ESPN data. Starting QB out? That's -80 Elo points, calculated for you.
          </td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;vertical-align:top;color:${ACCENT_COLOR};font-size:16px;">3.</td>
          <td style="padding:8px 0;color:${TEXT_COLOR};font-size:16px;line-height:1.5;">
            <strong style="color:white;">Compare our probability vs the market</strong> — When our Elo model says 75% but the market implies 60%, that's a 15% edge worth investigating.
          </td>
        </tr>
      </table>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        We cover NBA, NFL, NHL, MLB, college sports, and major soccer leagues — 692 teams total.
      </p>
      ${ctaButton('Start Exploring Edges', 'https://betanalytics.ai/chat')}
      <p style="color:${MUTED_COLOR};font-size:14px;margin:0;">
        You have 3 free queries to try it out. No credit card needed.
      </p>
    `),
  }
}

export function day2ValueDemo(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hey ${name}` : 'Hey'
  return {
    subject: 'How Elo ratings find edges the market misses',
    html: emailWrapper(`
      <h1 style="color:white;font-size:24px;margin:0 0 16px 0;">${greeting}, here's the math behind the edge</h1>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        You signed up yesterday — here's a quick look at how our Elo system actually works, so you can see why it finds edges other tools miss.
      </p>

      <div style="background-color:${BG_COLOR};border-radius:12px;padding:20px;margin:0 0 20px 0;">
        <p style="color:${ACCENT_COLOR};font-size:14px;font-weight:600;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:1px;">How Elo Ratings Work</p>
        <p style="color:${TEXT_COLOR};font-size:15px;line-height:1.6;margin:0 0 12px 0;">
          Every team starts at 1500. Win games and your rating goes up. Lose and it goes down. The key: we weight recent games more heavily, so a team on a hot streak is reflected in our model before the market catches up.
        </p>
        <p style="color:${TEXT_COLOR};font-size:15px;line-height:1.6;margin:0;">
          We then convert the Elo difference between two teams into a win probability. If our probability differs significantly from what the odds imply, that's an edge.
        </p>
      </div>

      <div style="background-color:${BG_COLOR};border-radius:12px;padding:20px;margin:0 0 20px 0;">
        <p style="color:${ACCENT_COLOR};font-size:14px;font-weight:600;margin:0 0 12px 0;text-transform:uppercase;letter-spacing:1px;">Example Edge Calculation</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="color:${MUTED_COLOR};font-size:14px;padding:6px 0;">Our Elo Model</td>
            <td style="color:white;font-size:14px;padding:6px 0;text-align:right;font-weight:700;">86.7%</td>
          </tr>
          <tr>
            <td style="color:${MUTED_COLOR};font-size:14px;padding:6px 0;">Market Implied</td>
            <td style="color:white;font-size:14px;padding:6px 0;text-align:right;font-weight:700;">68.6%</td>
          </tr>
          <tr>
            <td colspan="2" style="border-top:1px solid ${MUTED_COLOR};padding-top:8px;"></td>
          </tr>
          <tr>
            <td style="color:${MUTED_COLOR};font-size:14px;padding:6px 0;">Edge Found</td>
            <td style="color:${ACCENT_COLOR};font-size:14px;padding:6px 0;text-align:right;font-weight:700;">+18.1%</td>
          </tr>
        </table>
      </div>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        This isn't a guarantee — it's a probability. But when you consistently find edges like this, the math works in your favor over time.
      </p>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        We also adjust for injuries automatically. A starting QB being ruled out shifts our Elo by -80 points, which can flip an edge entirely.
      </p>

      ${ctaButton('Find Today\'s Edges', 'https://betanalytics.ai/chat')}
      <p style="color:${MUTED_COLOR};font-size:14px;margin:0;">
        Want to learn more? <a href="https://betanalytics.ai/methodology" style="color:${ACCENT_COLOR};text-decoration:underline;">Read our full methodology</a>
      </p>
    `),
  }
}

export function day3TrialEnding(name: string | null): { subject: string; html: string } {
  const greeting = name ? `${name}, your` : 'Your'
  return {
    subject: 'Your free trial ends today',
    html: emailWrapper(`
      <h1 style="color:white;font-size:24px;margin:0 0 16px 0;">${greeting} free trial is ending</h1>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        Your 3 free queries are about to expire. After that, you'll lose access to:
      </p>

      <table cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:16px;">&#10003;</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">Elo-based edge detection across all major sports</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:16px;">&#10003;</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">Real-time injury-adjusted probabilities</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:16px;">&#10003;</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">Player props analysis</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:16px;">&#10003;</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">Full methodology transparency — see every calculation</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:16px;">&#10003;</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">Hourly odds updates across 692 teams</td>
        </tr>
      </table>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        The sportsbooks have sophisticated models. BetAnalytics gives you one too — for $39/month.
      </p>

      ${ctaButton('Subscribe Now — $39/month', 'https://betanalytics.ai/pricing')}
      <p style="color:${MUTED_COLOR};font-size:14px;margin:0;">
        Cancel anytime. No contracts. No hidden fees.
      </p>
    `),
  }
}

export function day5TrialExpired(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hey ${name}` : 'Hey'
  return {
    subject: 'Your trial has expired — here\'s what you\'re missing',
    html: emailWrapper(`
      <h1 style="color:white;font-size:24px;margin:0 0 16px 0;">${greeting}, your trial has expired</h1>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        Your free queries are used up, but the edges are still there. Every day, our Elo model identifies matchups where our probability differs significantly from what the market implies.
      </p>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        Here's what's been happening since you signed up:
      </p>

      <table cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:18px;font-weight:700;">692</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">teams tracked and rated daily</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:18px;font-weight:700;">24/7</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">injury monitoring with automatic Elo adjustments</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;color:${ACCENT_COLOR};font-size:18px;font-weight:700;">Hourly</td>
          <td style="padding:6px 0;color:${TEXT_COLOR};font-size:15px;">odds updates to catch line movements</td>
        </tr>
      </table>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        Every game where our model disagrees with the market is an opportunity you're not seeing. Subscribe to get unlimited access to every edge, every day.
      </p>

      ${ctaButton('Get Unlimited Access — $39/month', 'https://betanalytics.ai/pricing')}
      <p style="color:${MUTED_COLOR};font-size:14px;margin:0;">
        Cancel anytime. No contracts.
      </p>
    `),
  }
}

export function week2Winback(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hey ${name}` : 'Hey'
  return {
    subject: 'Still looking for an edge?',
    html: emailWrapper(`
      <h1 style="color:white;font-size:24px;margin:0 0 16px 0;">${greeting}, still interested in finding edges?</h1>
      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 16px 0;">
        It's been about two weeks since you signed up. If you've been betting without an independent model, you might be leaving value on the table.
      </p>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        Here's what makes BetAnalytics different from everything else out there:
      </p>

      <div style="background-color:${BG_COLOR};border-radius:12px;padding:20px;margin:0 0 20px 0;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td style="padding:8px 0;color:white;font-size:15px;font-weight:600;">No black box</td>
          </tr>
          <tr>
            <td style="padding:0 0 12px 0;color:${MUTED_COLOR};font-size:14px;">You see every Elo rating, every injury adjustment, every edge calculation. Full transparency.</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:white;font-size:15px;font-weight:600;">Independent probabilities</td>
          </tr>
          <tr>
            <td style="padding:0 0 12px 0;color:${MUTED_COLOR};font-size:14px;">We calculate our own numbers — we don't copy the market. That's how we find where the market is wrong.</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:white;font-size:15px;font-weight:600;">Real injury quantification</td>
          </tr>
          <tr>
            <td style="padding:0 0 12px 0;color:${MUTED_COLOR};font-size:14px;">We don't just mention injuries — we calculate their exact Elo impact. Starting QB out = -80 points. Automatically.</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:white;font-size:15px;font-weight:600;">All major sports</td>
          </tr>
          <tr>
            <td style="padding:0;color:${MUTED_COLOR};font-size:14px;">NBA, NFL, NHL, MLB, college sports, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, MLS, Champions League.</td>
          </tr>
        </table>
      </div>

      <p style="color:${TEXT_COLOR};font-size:16px;line-height:1.6;margin:0 0 8px 0;">
        The sportsbooks have models. Shouldn't you?
      </p>

      ${ctaButton('Subscribe — $39/month', 'https://betanalytics.ai/pricing')}
      <p style="color:${MUTED_COLOR};font-size:14px;margin:0;">
        Cancel anytime. No contracts. No hidden fees.
      </p>
    `),
  }
}
