import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { firstValueFrom, Observable } from 'rxjs';

@Injectable()
export class ConfigurationService {
    private config: Promise<Config>;

    constructor(private httpClient: HttpClient) {
        this.config = firstValueFrom(this.loadConfig());
    }

    async getApiUrl(provider: string, path: string, parts: string[] = [], queryString: { [key: string]: string } = {}): Promise<string> {
        const queryStringEntries = Object.entries(queryString);
        const config = await this.config;
        const providerUrl = config.providers[provider];
        if (!providerUrl) {
            console.error(`Could not find URL for provider ${provider} configuration`);
            console.log([provider, path, parts, queryString, config]);
        }
        return providerUrl + path +
            (parts.length ? '/' + parts.map(p => encodeURIComponent(p)).join('/') : '') +
            (queryStringEntries.length
                ? queryStringEntries.map(([key, value], index) => `${index ? '&' : '?'}${key}=${value}`)
                : '');
    }

    async getUploadApiUrl(path: string) {
        const uploadUrl = (await this.config).uploadUrl;
        return uploadUrl ? uploadUrl + path : undefined;
    }

    async getUploadProvider() {
        return (await this.config).uploadProvider;
    }

    async getAlpinoUrl(path: string) {
        return (await this.config).alpino + path;
    }

    async getDjangoUrl(path: string) {
        return (await this.config).django + path;
    }

    async getProviders() {
        return Object.keys((await this.config).providers);
    }

    private loadConfig(): Observable<Config> {
        return this.httpClient.get<Config>(`assets/config/config.${environment.name}.json`);
    }
}

interface Config {
    providers: {
        [key: string]: string
    },
    /**
     * Alpino endpoint.
     * This should not be the raw alpino in server-mode, but should implement as according to gretel4/api/router.php
     */
    alpino: string,
    /**
     * Uploading is not federated and only supports a single endpoint.
     * This can be on a different domain!
     */
    uploadUrl: string;
    /** Uploading requires a provider to request results */
    uploadProvider: string;

    django: string;
}
