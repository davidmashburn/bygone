// Invented workshop instructions: long paragraphs, expanded numbered steps,
// and several paragraphs rewritten together. No user document text is used.
function proseDiffFixture() {
    const introduction = 'The neighborhood workshop welcomes people who want to repair everyday objects and learn from one another. ' +
        'At the entrance, volunteers explain where to find the tools, how to reserve a bench, and which projects need a second pair of hands. ' +
        'Visitors may bring a small appliance, a torn backpack, or a wooden toy, but should leave anything containing fuel at home. ' +
        'The coordinator keeps a paper register of arrivals so that the team can estimate how much space remains. ' +
        'Before the doors open, check the lamps, clear the walking routes, and place the instruction cards beside the shared equipment. ' +
        'A quiet table near the window is available for anyone who needs more time to read the instructions.';
    const before = [
        '# Neighborhood repair workshop', '', introduction, '', '## Opening routine', '',
        '1. Collect the keys from the caretaker.',
        '2. Set the tables beside the windows.',
        '3. Check the register before admitting visitors.',
        '4. Put the spare tools on the shelf.',
        '5. Show the volunteers the exit route.',
        '6. Open the doors at nine.', '', '## Handover', '',
        'Give the next coordinator the register and explain which repairs are still waiting.',
        'Leave the keys in the cupboard and write a short note about any missing tools.',
        'Return the borrowed lamps before the caretaker closes the building.'
    ];
    const feedback = [
        ...before.slice(0, 2), introduction.replace('instruction cards', 'laminated instruction cards'),
        ...before.slice(3, 6),
        '1. Collect the keys from the morning caretaker.',
        '2. Set the tables beside the large windows.',
        '3. Check the register, compare the reserved benches with the available spaces, and contact the coordinator before admitting visitors who need electrical equipment.',
        '4. Mark reserved spaces with a purple card.',
        '5. Put the spare tools on the lower shelf.',
        '6. Show the volunteers both exit routes.',
        '7. Ask each volunteer to test a lamp.',
        '8. Place a water jug near the entrance.',
        '9. Open the doors at ten.', '', '## Handover', '',
        'Give the next coordinator the updated register and explain which repairs need replacement parts.',
        'Leave the keys in the locked cupboard. Write a separate note about any missing tools.',
        'Return the borrowed lamps on Monday, before the caretaker closes the building.'
    ];
    const revision = feedback.map(line => line
        .replace('paper register of arrivals', 'digital register of arrivals')
        .replace('purple card', 'orange card')
        .replace('on Monday', 'on Tuesday'));
    return { before, feedback, revision };
}

module.exports = { proseDiffFixture };
