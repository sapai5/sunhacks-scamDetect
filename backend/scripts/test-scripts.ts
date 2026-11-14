// The 4 test scripts from the design doc. Used by run-scripts.ts against the
// deployed Analyze Lambda, and as sample data for the web app.
import type { Level } from '../../contracts/index.js';

export interface TestScript {
  name: string;
  /** Highest level the call should reach. */
  expectedPeak: Level;
  /** Simulated verification answer, applied after the first ask_verification. */
  verificationAnswer?: 'passed' | 'failed';
  lines: string[];
}

export const TEST_SCRIPTS: TestScript[] = [
  {
    name: 'grandparent-scam',
    expectedPeak: 'red',
    verificationAnswer: 'failed',
    lines: [
      "Hi Grandma, it's me.",
      "Yeah, it's your grandson. I have a cold, that's why my voice sounds weird.",
      "Grandma, I'm in trouble. I got in a car accident and they took me to jail.",
      'I need two thousand dollars for bail right now or they will keep me overnight.',
      "Please don't tell Mom and Dad, they'll be so mad at me.",
      'My lawyer says you can pay with gift cards from Target. Can you go get them today?',
      'Just read me the numbers on the back once you have them.',
    ],
  },
  {
    name: 'bank-reminder-legit',
    expectedPeak: 'green',
    lines: [
      'Hello, this is Maria calling from Desert Financial Credit Union.',
      'This is a courtesy reminder that your auto loan payment is due on the fifteenth.',
      'You can pay online, in a branch, or by calling the number on the back of your card.',
      "If you've already paid, please disregard this message. Have a great day.",
    ],
  },
  {
    name: 'grandkid-hi-legit',
    expectedPeak: 'green',
    verificationAnswer: 'passed',
    lines: [
      "Hi Grandma, it's Jake!",
      'I just wanted to call and say I got the job at the hospital.',
      'Yeah, I start on Monday. Mom said she told you I had the interview.',
      'Are we still doing dinner on Sunday? I can pick you up at five.',
      'Okay, love you, talk soon.',
    ],
  },
  {
    name: 'tech-support-scam',
    expectedPeak: 'red',
    lines: [
      'Hello, this is David from Microsoft Windows technical department.',
      'We are seeing a virus on your computer that is sending your bank details to hackers.',
      'You must act right now or your bank account will be frozen today.',
      'Please go to your computer and install AnyDesk so I can fix it for you.',
      'Then I will need your online banking password to secure the account.',
    ],
  },
];
