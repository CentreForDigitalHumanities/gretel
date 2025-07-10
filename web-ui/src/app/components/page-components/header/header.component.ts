import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { Notification, NotificationService } from '../../../services/notification.service';
import { animations } from '../../../animations';

type messageTypes = {
    [type in Exclude<'cancel', Notification['type']>]: HeaderComponent['messageType'];
};
const mapping: messageTypes = {
    'error': 'is-danger',
    'success': 'is-success',
    'warning': 'is-warning'
};

@Component({
    selector: 'grt-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
    animations
})
export class HeaderComponent implements OnDestroy, OnInit {
    private subscriptions: Subscription[] = [];
    private messageId: number;
    message: string;
    progress?: number;
    messageType: 'is-warning' | 'is-danger' | 'is-success';
    menuExpanded = false;
    show = false;

    constructor(private notificationService: NotificationService, private ngZone: NgZone) {
    }

    ngOnInit() {
        this.subscriptions = [
            this.notificationService.notifications$.subscribe(notification => {
                switch (notification.type) {
                    case 'cancel':
                        if (notification.id === undefined || this.messageId === notification.id) {
                            this.show = false;
                        }
                        return;

                    case 'success':
                    case 'warning':
                        this.messageType = mapping[notification.type];
                        // hide the message after some time
                        setTimeout(() => {
                            this.ngZone.run(() => {
                                if (this.messageId === notification.id) { this.show = false; }
                            });
                        }, 5000);
                        break;

                    default:
                        this.messageType = mapping[notification.type];
                        break;
                }

                this.message = notification.message;
                this.messageId = notification.id;
                this.progress = notification.progress;
                this.show = true;
            })
        ];
    }

    ngOnDestroy() {
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
    }
}
