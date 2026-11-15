// Test scripts for the Analyze and Agent Lambdas. Used by run-scripts.ts
// against the deployed Lambdas, and by the web app's demo mode.
import type { AgentStatus, Level } from '../../contracts/index.js';

export interface Line {
  speaker: 'caller' | 'elder';
  text: string;
}

export interface TestScript {
  name: string;
  /** Highest level the call should reach. */
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
];
