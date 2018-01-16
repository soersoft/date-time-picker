/**
 * date-time-picker.component
 */

import {
    ChangeDetectionStrategy, ChangeDetectorRef, Component, ComponentRef, EventEmitter, Inject, Input, NgZone, OnDestroy,
    OnInit, Optional, Output
} from '@angular/core';
import { AnimationEvent } from '@angular/animations';
import { DOCUMENT } from '@angular/common';
import { OwlDateTimeContainerComponent } from './date-time-picker-container.component';
import { OwlDateTimeInputDirective } from './date-time-picker-input.directive';
import { DateTimeAdapter } from './adapter/date-time-adapter.class';
import { OWL_DATE_TIME_FORMATS, OwlDateTimeFormats } from './adapter/date-time-format.class';
import { OwlDateTime } from './date-time.class';
import { OwlDialogRef, OwlDialogService } from '../dialog';
import { ComponentPortal } from '../portal';
import { OwlOverlayComponent } from '../overlay';
import { DomHandlerService, InjectionService } from '../utils';
import { Subscription } from 'rxjs/Subscription';
import { take } from 'rxjs/operators';

@Component({
    selector: 'owl-date-time',
    exportAs: 'owlDateTime',
    templateUrl: './date-time-picker.component.html',
    styleUrls: ['./date-time-picker.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    preserveWhitespaces: false,
})

export class OwlDateTimeComponent<T> extends OwlDateTime<T> implements OnInit, OnDestroy {

    /** The date to open the calendar to initially. */
    private _startAt: T | null;
    get startAt(): T | null {
        // If an explicit startAt is set we start there, otherwise we start at whatever the currently
        // selected value is.
        if (this._startAt) {
            return this._startAt;
        }

        if (this._dtInput) {

            if (this._dtInput.selectMode === 'single') {
                return this._dtInput.value || null;
            } else if (this._dtInput.selectMode === 'range') {
                return this._dtInput.values[0] || null;
            }

        } else {
            return null;
        }
    }

    @Input()
    set startAt( date: T | null ) {
        this._startAt = this.getValidDate(this.dateTimeAdapter.deserialize(date));
    }

    /**
     * Whether the picker open as a dialog
     * @default {false}
     * @type {boolean}
     * */
    _pickerMode: 'popup' | 'dialog' | 'inline' = 'popup';
    @Input()
    get pickerMode() {
        return this._pickerMode;
    }

    set pickerMode( mode: 'popup' | 'dialog' | 'inline' ) {
        if (mode === 'popup') {
            this._pickerMode = mode;
        } else {
            this._pickerMode = 'dialog';
        }
    }

    /** Whether the date time picker should be disabled. */
    private _disabled: boolean;
    @Input()
    get disabled(): boolean {
        return this._disabled === undefined && this.dtInput ?
            this.dtInput.disabled : !!this._disabled;
    }

    set disabled( value: boolean ) {
        if (value !== this._disabled) {
            this._disabled = value;
            this.disabledChange.next(value);
        }
    }

    /**
     * Callback when the picker is closed
     * */
    @Output() afterPickerClosed = new EventEmitter<any>();

    /**
     * Callback when the picker is open
     * */
    @Output() afterPickerOpen = new EventEmitter<any>();

    /**
     * Emit when the selected value has been confirmed
     * */
    public confirmSelectedChange = new EventEmitter<T[] | T>();

    /**
     * Emits when the date time picker is disabled.
     * */
    public disabledChange = new EventEmitter<boolean>();

    public opened: boolean;

    private pickerContainerRef: ComponentRef<any>;
    private pickerContainer: OwlDateTimeContainerComponent<T>;
    private popupRef: ComponentRef<any>;
    private dialogRef: OwlDialogRef<OwlDateTimeContainerComponent<T>>;
    private dtInputSub: Subscription;
    private hidePickerStreamSub: Subscription;
    private confirmSelectedStreamSub: Subscription;

    /** The element that was focused before the date time picker was opened. */
    private focusedElementBeforeOpen: HTMLElement | null = null;

    private _dtInput: OwlDateTimeInputDirective<T>;
    get dtInput() {
        return this._dtInput;
    }

    private _selected: T | null;
    get selected() {
        return this._selected;
    }

    set selected( value: T | null ) {
        this._selected = value;
        this.changeDetector.markForCheck();
    }

    private _selecteds: T[] = [];
    get selecteds() {
        return this._selecteds;
    }

    set selecteds( values: T[] ) {
        this._selecteds = values;
        this.changeDetector.markForCheck();
    }

    /** The minimum selectable date. */
    get minDateTime(): T | null {
        return this.dtInput && this.dtInput.min;
    }

    /** The maximum selectable date. */
    get maxDateTime(): T | null {
        return this.dtInput && this.dtInput.max;
    }

    get dateTimeFilter(): ( date: T | null ) => boolean {
        return this.dtInput && this.dtInput.dateTimeFilter;
    }

    get selectMode(): 'single' | 'range' {
        return this.dtInput.selectMode;
    }

    constructor( private injectionService: InjectionService,
                 private dialogService: OwlDialogService,
                 private ngZone: NgZone,
                 private domHandler: DomHandlerService,
                 protected changeDetector: ChangeDetectorRef,
                 @Optional() protected dateTimeAdapter: DateTimeAdapter<T>,
                 @Optional() @Inject(OWL_DATE_TIME_FORMATS) protected dateTimeFormats: OwlDateTimeFormats,
                 @Optional() @Inject(DOCUMENT) private document: any ) {
        super(dateTimeAdapter, dateTimeFormats);
    }

    public ngOnInit() {
    }

    public ngOnDestroy(): void {
        this.dtInputSub.unsubscribe();
        this.disabledChange.complete();

        if (this.popupRef) {
            this.popupRef.destroy();
            this.popupRef = null;
        }

        if (this.dialogRef) {
            this.dialogRef.close();
            this.dialogRef = null;
        }

        if (this.hidePickerStreamSub) {
            this.hidePickerStreamSub.unsubscribe();
            this.hidePickerStreamSub = null;
        }

        if (this.confirmSelectedStreamSub) {
            this.confirmSelectedStreamSub.unsubscribe();
            this.confirmSelectedStreamSub = null;
        }
    }

    public registerInput( input: OwlDateTimeInputDirective<T> ): void {
        if (this._dtInput) {
            throw Error('A Owl DateTimePicker can only be associated with a single input.');
        }

        this._dtInput = input;
        this.dtInputSub = this._dtInput.valueChange.subscribe(( value: T[] | T | null ) => {
            if (Array.isArray(value)) {
                this.selecteds = value;
            } else {
                this.selected = value;
            }
        });
    }

    public open(): void {

        if (this.opened || this.disabled) {
            return;
        }

        if (!this.dtInput) {
            throw Error('Attempted to open an DateTimePicker with no associated input.');
        }

        if (this.document) {
            this.focusedElementBeforeOpen = this.document.activeElement;
        }

        // reset the picker selected value
        if (this.dtInput.selectMode === 'single') {
            this.selected = this.dtInput.value;
        } else if (this.dtInput.selectMode === 'range') {
            this.selecteds = this.dtInput.values;
        }

        this.pickerMode === 'dialog' ?
            this.openAsDialog() :
            this.openAsPopup();


        this.pickerContainer.picker = this;

        // Listen to picker container's hidePickerStream
        this.hidePickerStreamSub = this.pickerContainer.hidePickerStream
            .subscribe(() => {
                this.hidePicker();
            });

        // Listen to picker container's confirmSelectedStream
        this.confirmSelectedStreamSub = this.pickerContainer.confirmSelectedStream
            .subscribe(( event: any ) => {
                this.confirmSelect(event);
            });

        this.opened = true;
    }

    /**
     * Selects the given date
     * @param date -- a date to be selected
     * @return {void}
     * */
    public select( date: T[] | T ): void {

        if (Array.isArray(date)) {
            this.selecteds = [...date];
        } else {
            this.selected = date;
        }

        /**
         * Cases in which automatically confirm the select when date or dates are selected:
         * 1) picker mode is NOT 'dialog'
         * 2) picker type is 'calendar' and selectMode is 'single'.
         * 3) picker type is 'calendar' and selectMode is 'range' and
         *    the 'selecteds' has 'from'(selecteds[0]) and 'to'(selecteds[1]) values.
         * */
        if (this.pickerMode !== 'dialog' &&
            this.pickerType === 'calendar' &&
            (this.selectMode === 'single' || (this.selectMode === 'range' && this.selecteds[0] && this.selecteds[1]))) {
            this.confirmSelect();
        }
    }

    /**
     * Confirm the selected value
     * @param {any} event
     * @return {void}
     * */
    private confirmSelect( event?: any ): void {

        if (this.selectMode === 'single') {
            const selected = this.selected || this.startAt || this.dateTimeAdapter.now();
            this.confirmSelectedChange.emit(selected);
        } else if (this.selectMode === 'range') {
            this.confirmSelectedChange.emit(this.selecteds);
        }

        this.hidePicker(event);
        return;
    }

    /**
     * Hide the picker
     * @param {any} event
     * @return {void}
     * */
    private hidePicker( event?: any ): void {
        if (!this.opened) {
            return;
        }

        if (this.dialogRef) {
            this.dialogRef.close();
        }

        if (this.popupRef) {
            this.pickerContainer.hidePickerViaAnimation();
        }
    }

    /**
     * Open the picker as a dialog
     * @return {void}
     * */
    private openAsDialog(): void {
        this.dialogRef = this.dialogService.open(OwlDateTimeContainerComponent, {
            autoFocus: false,
            paneStyle: {padding: 0}
        });
        this.pickerContainer = this.dialogRef.componentInstance;

        this.dialogRef.afterOpen().subscribe(() => this.afterPickerOpen.emit(null));
        this.dialogRef.afterClosed().subscribe(() => this.clean());
    }

    /**
     * Open the picker as popup
     * @return {void}
     * */
    private openAsPopup(): void {
        if (!this.popupRef) {
            this.popupRef = this.createOverlay();
        }

        const overlay = this.popupRef.instance;
        const paneRef = overlay.attachPane();
        this.pickerContainerRef = paneRef.instance.attachComponentPortal(new ComponentPortal(OwlDateTimeContainerComponent));
        this.pickerContainer = this.pickerContainerRef.instance;
        this.pickerContainer.showPickerViaAnimation();

        this.ngZone.onStable.asObservable().pipe(take(1)).subscribe(() => {
            const containerHeight = this.pickerContainer.containerElm.offsetHeight;
            paneRef.instance.overlayPaneStyle = this.getOverlayPanePosition(containerHeight);
        });

        // Listen to backdrop click stream
        overlay.backdropClick.subscribe(() => this.pickerContainer.hidePickerViaAnimation());

        // Listen to picker's container animation state
        this.pickerContainer.animationStateChanged.subscribe(( event: AnimationEvent ) => {
            if (event.phaseName === 'done' && event.toState === 'visible') {
                this.afterPickerOpen.emit(null);
            }

            if (event.phaseName === 'done' && event.toState === 'hidden') {
                this.clean();
            }
        });
    }

    /**
     * Create an overlay for popup
     * */
    private createOverlay() {
        const overlayRef = this.injectionService.appendComponent(OwlOverlayComponent);
        overlayRef.instance.applyBackdropConfig({
            backdropClass: 'owl-transparent-backdrop'
        });
        return overlayRef;
    }

    /**
     * Clean all the dynamic components
     * @return {void}
     * */
    private clean(): void {
        if (!this.opened) {
            return;
        }

        if (this.popupRef) {
            this.popupRef.destroy();
            this.popupRef = null;
        }

        if (this.hidePickerStreamSub) {
            this.hidePickerStreamSub.unsubscribe();
            this.hidePickerStreamSub = null;
        }

        if (this.confirmSelectedStreamSub) {
            this.confirmSelectedStreamSub.unsubscribe();
            this.confirmSelectedStreamSub = null;
        }

        if (this.dialogRef) {
            this.dialogRef.close();
            this.dialogRef = null;
        }

        // focus back to the focusedElement before the picker is open
        if (this.focusedElementBeforeOpen &&
            typeof this.focusedElementBeforeOpen.focus === 'function') {
            this.focusedElementBeforeOpen.focus();
            this.focusedElementBeforeOpen = null;
        }

        this.opened = false;
        this.afterPickerClosed.emit(null);
    }

    /**
     * Get the overlay pane's position style
     * It attaches the overlay pane to the picker's
     * input and adjusts to the viewport.
     * */
    private getOverlayPanePosition( containerHeight: number ): any {
        const inputRect = this._dtInput.inputRect;
        const paneOffsetX = inputRect.left;
        let paneOffsetY = inputRect.bottom;

        const viewportRect = this.domHandler.getViewport();
        const bottomAvailableSpace = viewportRect.height - inputRect.bottom;

        if (containerHeight > bottomAvailableSpace) {
            paneOffsetY = inputRect.top - containerHeight;
        }

        if (paneOffsetY < 0) {
            paneOffsetY = 10;
        }

        return {'left.px': paneOffsetX, 'top.px': paneOffsetY};
    }
}
