// Test scripts for the Analyze and Agent Lambdas. Used by run-scripts.ts
// against the deployed Lambdas, and by the web app's demo mode.
import type { AgentStatus, Level } from '../../contracts/index.js';

export interface Line {
  speaker: 'caller' | 'elder';
  text: string;
}

export interface TestScript {
  name: string;
  /** Scam scripts must reach red; for the others it's the highest level allowed. */
  expectedPeak: Level;
  expectAlert: boolean;
  /** Expected final agent status. 'idle' means the agent never takes over. */
  expectedAgent: AgentStatus;
  /** Simulated verification answer from the elder's card, applied after the first ask_verification. */
  verificationAnswer?: 'passed' | 'failed';
  lines: Line[];
  /** What the caller says back to the agent, one entry per agent turn. */
  agentReplies?: string[];
}

const caller = (text: string): Line => ({ speaker: 'caller', text });
const elder = (text: string): Line => ({ speaker: 'elder', text });

export const TEST_SCRIPTS: TestScript[] = [
  {
    name: 'grandparent-scam',
    expectedPeak: 'red',
    expectAlert: true,
    expectedAgent: 'scam_confirmed',
    lines: [
      caller("Hi Grandma, it's me."),
      elder('Tommy? Is that you?'),
      caller("Yeah, it's Tommy. I have a cold, that's why my voice sounds weird."),
      // Isolation tactic: triggers the off_speaker_requested call event in the demo.
      caller("Can you take me off speaker? I don't want anyone else to hear this."),
      caller("Grandma, I'm in trouble. I got in a car accident and they took me to jail."),
      elder('Oh my goodness, are you okay? What do you need, honey?'),
      caller('I need two thousand dollars for bail right now or they will keep me overnight.'),
      caller("Please don't tell Mom and Dad, they'll be so mad at me."),
      elder("Okay, okay, I won't tell them. How do I send it?"),
      caller('My lawyer says you can pay with gift cards from Target. Can you go get them today?'),
      elder("All right, I'll go to Target right now and get the cards."),
    ],
    agentReplies: [
      "Uh, hi, I really need to talk to Grandma, it's an emergency.",
      "I don't remember, I hit my head in the accident. Please just put Grandma back on, there's no time.",
      'Look, if she does not get the cards in the next hour I stay in jail. Put her back on.',
    ],
  },
  {
    name: 'real-grandson-asks-money',
    expectedPeak: 'red',
    expectAlert: true,
    expectedAgent: 'verified',
    lines: [
      caller("Hi Grandma, it's Tommy."),
      elder('Tommy! How are you, sweetheart?'),
      caller("Not great. My car broke down and I need eight hundred dollars for the repair today, the shop closes at five."),
      caller("Please don't tell Mom, she already thinks I'm bad with money."),
      elder("Oh honey, of course. I'll send it to you on Zelle right now."),
    ],
    agentReplies: ["Uncle Mike? Oh, hey. Okay, sure, go ahead.", "Biscuit. He was the golden retriever."],
  },
  {
    name: 'bank-reminder-legit',
    expectedPeak: 'green',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller('Hello, this is Maria calling from Desert Financial Credit Union.'),
      caller('This is a courtesy reminder that your auto loan payment is due on the fifteenth.'),
      elder('Oh, thank you, I think I already paid it.'),
      caller('You can check online, in a branch, or by calling the number on the back of your card.'),
      caller("If you've already paid, please disregard this message. Have a great day."),
    ],
  },
  {
    name: 'grandkid-hi-legit',
    expectedPeak: 'green',
    expectAlert: false,
    expectedAgent: 'idle',
    verificationAnswer: 'passed',
    lines: [
      caller("Hi Grandma, it's Jake!"),
      elder('Jake! So good to hear from you.'),
      caller('I just wanted to call and say I got the job at the hospital.'),
      elder("That's wonderful, I'm so proud of you."),
      caller('Are we still doing dinner on Sunday? I can pick you up at five.'),
      caller('Okay, love you, talk soon.'),
    ],
  },
  {
    name: 'tech-support-scam',
    expectedPeak: 'red',
    expectAlert: true,
    expectedAgent: 'scam_confirmed',
    lines: [
      caller('Hello, this is David from Microsoft Windows technical department.'),
      caller('We are seeing a virus on your computer that is sending your bank details to hackers.'),
      elder('Oh no, what should I do?'),
      caller('You must act right now or your bank account will be frozen today.'),
      caller('Please go to your computer and install AnyDesk so I can fix it for you.'),
      elder("Okay, I'm at the computer now. I'm typing in AnyDesk."),
    ],
    agentReplies: [
      "Sir, this is very urgent, I need to speak with the account holder, she must install the program now.",
      "We don't give out callback numbers, this is a security matter. Put her back on or her account will be frozen.",
    ],
  },

  // Hard legit calls: they look like scams on the surface. Yellow is fine; red, an alert or a takeover is not.
  {
    name: 'bank-fraud-check-legit',
    expectedPeak: 'yellow',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller('Hi, this is Karen from the Chase fraud prevention team, calling for Rose.'),
      caller('We noticed a charge of four hundred eighty dollars at a Best Buy in Denver this morning. Did you make that purchase?'),
      elder("No, I haven't been to Denver. Oh dear."),
      caller("Okay, thank you. I've blocked that card so nothing else goes through, and a new card will arrive in the mail in five to seven days."),
      caller("We will never ask for your PIN, your full card number or a code. If you'd like to double check this call, hang up and call the number on the back of your card."),
      elder("Thank you, I'll call that number just to be safe."),
      caller("That's a great idea. Have a good afternoon."),
    ],
  },
  {
    name: 'family-emergency-legit',
    expectedPeak: 'yellow',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller("Grandma, it's Emily. Grandpa fell in the garden and they took him to Banner hospital."),
      elder('Oh my goodness, is he okay?'),
      caller("The doctors think it's just his wrist, but they want to keep him overnight."),
      caller('Dad is driving over to pick you up in twenty minutes so you can see him.'),
      elder("Okay, I'll get my coat and my purse and wait by the door."),
      caller('Bring his reading glasses and his phone charger. Love you, see you soon.'),
    ],
  },
  {
    name: 'internet-provider-legit',
    expectedPeak: 'yellow',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller('Hi, this is Marcus with Cox Communications, returning your call from this morning about your internet going out.'),
      elder('Oh yes, thank you for calling back.'),
      caller('I see there was an outage in your neighborhood. It was fixed about an hour ago.'),
      caller('Could you unplug the white box by your TV, wait thirty seconds, and plug it back in?'),
      elder("Okay, I did it. The lights are blinking now."),
      caller("Perfect, you should be back online. There's no charge for this. Anything else I can help with?"),
    ],
  },
  {
    name: 'doctor-office-legit',
    expectedPeak: 'yellow',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller("Good morning, this is Dr. Patel's office calling to confirm Rose's appointment."),
      caller('For privacy, can you please confirm your date of birth?'),
      elder("It's March third, nineteen forty-six."),
      caller("Thank you. You're scheduled for Thursday at ten thirty with Dr. Patel."),
      caller('Please bring your insurance card and a list of your medications. If you need to reschedule, just call the office.'),
      elder('Thursday at ten thirty, got it. Thank you.'),
    ],
  },
  {
    name: 'church-donation-legit',
    expectedPeak: 'yellow',
    expectAlert: false,
    expectedAgent: 'idle',
    lines: [
      caller("Hi Rose, it's Linda from Saint Mary's. How are you doing?"),
      elder("Linda! I'm doing well, thank you."),
      caller("We're collecting for the food bank drive this month. If you'd like to give, you can drop a check in the box at Sunday service."),
      caller("No pressure at all, every bit helps. We're also looking for volunteers to sort cans on Saturday."),
      elder("I'll bring a check on Sunday, and maybe I can help on Saturday too."),
      caller('Wonderful. See you Sunday!'),
    ],
  },
];
