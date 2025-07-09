import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import { ConfigurationService } from "./configuration.service";
import { ParserService } from 'lassy-xpath';
import { firstValueFrom } from 'rxjs';

export interface MweCanonicalForm {
    id: number,
    text: string
}

export interface MweQuery {
    id?: number;

    /** User-facing description of the query */
    description: string;
    xpath: string;
    rank: number;

    /** id of relevant canonical form */
    canonical: number;
}

export type MweQuerySet = MweQuery[];

@Injectable({
    providedIn: 'root'
})
export class MweService {
    canonicalMweUrl: Promise<string>;
    generateMweUrl: Promise<string>;

    constructor(configurationService: ConfigurationService, private http: HttpClient, private parserService: ParserService) {
        this.canonicalMweUrl = configurationService.getDjangoUrl('mwe/canonical');
        this.generateMweUrl = configurationService.getDjangoUrl('mwe/generate');
    }

    async getCanonical(): Promise<MweCanonicalForm[]> {
        return firstValueFrom(this.http.get<MweCanonicalForm[]>(await this.canonicalMweUrl));
    }

    /** Retrieve a query set for a given expression */
    async generateQuery(canonical: string): Promise<MweQuerySet> {
        let response = await firstValueFrom(this.http.post<MweQuerySet>(
            await this.generateMweUrl, { canonical }));

        response.forEach((query) => {
            query.xpath = this.parserService.format(query.xpath);
        });

        return response;
    }
}
