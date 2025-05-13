import { LegacyComponent } from "./legacy-component";
const BASE_URL = 'http://localhost';

function paramsToHash(searchParams: URLSearchParams) {
    const result: { [name: string]: string } = {};
    for (const [name, value] of searchParams.entries()) {
        result[name] = value;
    }
    return result;
}

describe('FormatNumberPipe', () => {
    it('rewrites the treebank names', () => {
        // from GrETEL 4 to GrETEL 5 the addresses of treebanks have changed
        // other than that, the addresses remained the same
        const tests: { from: string, to: string }[] = [
            {
                from: '/ng/home',
                to: '/home'
            },
            {
                from: '/ng/xpath-search?currentStep=1&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"cgn":%5B"CGN_ID_VB","CGN_ID_NC","CGN_ID_NE"%5D%7D%7D&retrieveContext=1',
                to: '/xpath-search?currentStep=1&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"cgn":%5B"cgn-nc","cgn-ne","cgn-vb"%5D%7D%7D&retrieveContext=1'
            },
            {
                from: '/ng/example-based-search?currentStep=4&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"lassy":%5B"LASSY_ID_DPC","LASSY_ID_WIKI","LASSY_ID_WRPE","LASSY_ID_WRPP","LASSY_ID_WSU"%5D%7D%7D&retrieveContext=0&inputSentence=Dit%20is%20een%20voorbeeldzin.&isCustomXPath=1&attributes=-rel:-rel:::&respectOrder=0&ignoreTopNode=1',
                to: '/example-based-search?currentStep=4&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"lassy-klein":%5B"dpc","wiki","wrpe","wrpp","wsu"%5D%7D%7D&retrieveContext=0&inputSentence=Dit%20is%20een%20voorbeeldzin.&isCustomXPath=1&attributes=-rel:-rel:::&respectOrder=0&ignoreTopNode=1'
            },
            {
                from: '/ng/xpath-search?currentStep=2&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"VanKampen":%5B"VANKAMPEN_ID_VANKAMPEN_LAURA","VANKAMPEN_ID_VANKAMPEN_SARAH"%5D%7D%7D&retrieveContext=0',
                to: '/xpath-search?currentStep=2&xpath=%2F%2Fnode&selectedTreebanks=%7B"gretel":%7B"GRETEL-UPLOAD-VanKampen":%5B"GRETEL-UPLOAD-VANKAMPEN_ID_VANKAMPEN_LAURA","GRETEL-UPLOAD-VANKAMPEN_ID_VANKAMPEN_SARAH"%5D%7D%7D&retrieveContext=0'
            }
        ]

        for (const { from, to } of tests) {
            const fromUrl = new URL(BASE_URL + from);
            const toUrl = new URL(BASE_URL + to);

            // removing 'ng/' from the start should be enough
            expect(fromUrl.pathname.substring(3)).toEqual(toUrl.pathname);
            const rewrittenParams = paramsToHash(fromUrl.searchParams);
            LegacyComponent.rewriteParams(rewrittenParams);
            expect(rewrittenParams).toEqual(paramsToHash(toUrl.searchParams));
        }
    });
});

