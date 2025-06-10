import { AnalysisService } from './analysis.service';

describe('Analysis Service', () => {
    let analysisService: AnalysisService;
    beforeEach(() => {
        analysisService = new AnalysisService();
    });

    it('Works', () => {
        const result = analysisService.getFlatTable(
            [{
                component: 'TEST_ID',
                database: 'TEST_ID',
                fileId: 'Test-1.xml',
                sentence: 'Hallo lieve mensen dit is een testzin .',
                previousSentence: 'Vorige zin',
                nextSentence: 'Volgende zin',
                highlightedSentence: '<strong>Hallo lieve mensen dit is een testzin .</strong>',
                nodeIds: [],
                nodeStarts: [],
                metaValues: { 'meta1': 'hallo' },
                treeXml: `<node>
    <node>
      <node>
        <node lemma="hallo" pos="tag"/>
        <node>
          <node lemma="lief" pos="adj" />
          <node lemma="mens" pos="noun" />
        </node>
      </node>
      <node>
        <node lemma="dit" pos="det" />
        <node lemma="zijn" pos="verb" />
        <node>
          <node lemma="een" pos="det" />
          <node lemma="test_zin" pos="noun" />
        </node>
      </node>
    </node>
    <node lemma="." pos="punct" />
  </node>`,
                variableValues: { '$node1': { lemma: undefined, pos: undefined } },
                attributes: {}
            }],
            {'$node1': ['pos', 'lemma']},
            ['meta1'],
            []);
        expect(result).toEqual([
            ['meta1', '$node1.pos', '$node1.lemma'],
            ['hallo', '(none)', '(none)']
        ]);
    });

    it('Deals with differing sentence lengths', () => {
        const result = analysisService.getFlatTable(
            [
                generateResult(3),
                generateResult(3),
                generateResult(4),
                generateResult(1)
            ],
            {'$node1': ['pos', 'lemma']},
            ['meta1'],
            []
        );
        expect(result).toEqual([
            ['meta1', '$node1.pos', '$node1.lemma'],
            ['hallo', 'test', 'test'],
            ['hallo', 'test', 'test'],
            ['hallo', 'test', 'test'],
            ['hallo', 'test', 'test'],
        ]);
    });

    function generateResult(count: number) {
        return {
            component: 'TEST',
            database: 'TEST_ID',
            fileId: 'Test-1.xml',
            sentence: 'Lorem ipsum',
            previousSentence: 'Vorige zin',
            nextSentence: 'Volgende zin',
            highlightedSentence: 'Lorem ipsum',
            nodeIds: [] as number[],
            nodeStarts: [] as number[],
            metaValues: { 'meta1': 'hallo' },
            treeXml: generateNodeXml(count),
            variableValues: { '$node1': { lemma: 'test', pos: 'test' } },
            attributes: {}
        };
    }

    function generateNodeXml(count: number) {
        return `<node>${new Array(count + 1).join('<node lemma="word" pos="verb" />')}</node>`;
    }
});
