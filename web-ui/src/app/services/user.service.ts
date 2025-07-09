import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { ConfigurationService } from './configuration.service';
import { NotificationService } from './notification.service';

type UserResponseSuccess = {
    id: string;
    logged_in: true;
    username: string;
}

type UserResponseFailure = {
    logged_in: false
}

type UserResponse = UserResponseSuccess | UserResponseFailure;

class InternalUser {
    id: number;
    displayName: string;
    username: string;

    constructor(response: UserResponseSuccess) {
        this.id = parseInt(response.id);
        this.displayName = response.username;
        this.username = response.username;
    }
};


export type User = {
    [key in keyof InternalUser]: InternalUser[key]
}


@Injectable({
    providedIn: 'root'
})
export class UserService {
    private _user$: BehaviorSubject<User>;
    private _canLogIn$ = new BehaviorSubject<boolean>(false);

    constructor(
        private http: HttpClient,
        private configurationService: ConfigurationService,
        private notificationService: NotificationService) { }

    public get user$() {
        if (this._user$) {
            return this._user$.asObservable();
        }

        this._user$ = new BehaviorSubject<User>(undefined);
        this.retrieveCurrent();
        return this._user$;
    }

    public get canLogin$() {
        return this._canLogIn$.asObservable();
    }

    /**
     * Retrieve the current user or set it to undefined
     */
    private async retrieveCurrent(): Promise<boolean> {
        const currentUrl = await this.configurationService.getUploadApiUrl('user');

        let response: UserResponse = await firstValueFrom(this.http.get(currentUrl, { withCredentials: true }))
            .catch((error: HttpErrorResponse) => null);

        if (response) {
            this._canLogIn$.next(true);

            if (!response.logged_in && response['id']) {
                // not set on server
                response.logged_in = true;
            }
        }

        return this.setUser(response);
    }

    /**
     * Logs the user in, returns true if successful
     */
    async login(username: string, password: string): Promise<boolean> {
        const loginUrl = await this.configurationService.getUploadApiUrl('user/login');

        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', password);

        const response = <UserResponse>await firstValueFrom(this.http.post(
            loginUrl,
            formData,
            { withCredentials: true }));

        var success = this.setUser(response);
        if (success) {
            if (!this.retrieveCurrent()) {
                this.notificationService.add('Your credentials are correct, but login failed anyway. Might be a cross-domain issue with session cookies.', 'error');
            }
        }

        return success;
    }

    /**
     * Logs the user out, returns true if successful
     */
    async logout(): Promise<boolean> {
        const logoutUrl = await this.configurationService.getUploadApiUrl('user/logout');

        try {
            await firstValueFrom(this.http.post(logoutUrl, null, { withCredentials: true }));
            this.setUser(undefined);
            return true;
        }
        catch (error) {
            console.error(error);
        }

        return false;
    }

    private setUser(response: UserResponse): boolean {
        if (!this._user$) {
            this._user$ = new BehaviorSubject<User>(undefined);
        }

        const user = response?.logged_in ? new InternalUser(response) : undefined;
        this._user$.next(user);

        return response?.logged_in ?? false;
    }
}
